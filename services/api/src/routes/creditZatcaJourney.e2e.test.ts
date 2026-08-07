import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// Critical journey: a distributor orders on credit terms, a ZATCA-stamped
// invoice is issued synchronously (routes/supplier.ts's issueInvoiceAndStamp,
// same request that places the order), the distributor submits a bank-
// transfer payment proof, an admin verifies it, and the statement/dashboard
// reconcile - asserting debt (credit.invoices), cash custody
// (credit.custody_ledger) and goods custody (pickup parcels) stay three
// separate numbers, never summed anywhere (D-14 rule f). credit.invoices
// has zero rows in production, ever - this is the first time any of this
// has executed against a real database.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010
const SEED_SUPPLIER_ROW_ID = "00000000-0000-0000-0000-00000000f003"; // 0055_supplier_seed.sql, bronze, SAR 20,000 limit

describe("Credit / ZATCA journey: wholesale order -> invoice -> payment -> statement (SP-01/04/05/06, AC-08)", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let supplierToken: string;
  let adminToken: string;
  let adminId: string;
  let dbClient: Client;
  let addressId: string;
  let packSizeId: string;

  async function seedProofMediaId(): Promise<string> {
    const row = await dbClient.query<{ id: string }>(
      `insert into core.media_objects (bucket, object_key, content_type, size_bytes, purpose)
       values ('ps-invoices', $1, 'image/png', 4, 'transfer_proof') returning id`,
      [`proof/${randomBytes(8).toString("hex")}.png`]
    );
    return row.rows[0]!.id;
  }

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54355);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-credit-zatca-e2e-"));
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    writeFileSync(path.join(dir, "jwt_private.pem"), privateKey);
    writeFileSync(path.join(dir, "jwt_public.pem"), publicKey);
    writeFileSync(path.join(dir, "mfa.key"), randomBytes(32).toString("base64"));

    process.env.DATABASE_URL = dbUrl;
    process.env.JWT_PRIVATE_KEY_PATH = path.join(dir, "jwt_private.pem");
    process.env.JWT_PUBLIC_KEY_PATH = path.join(dir, "jwt_public.pem");
    process.env.MFA_ENCRYPTION_KEY_PATH = path.join(dir, "mfa.key");
    process.env.JWT_ACCESS_TTL_SECONDS = "3600";
    process.env.JWT_REFRESH_TTL_SECONDS = "2592000";

    const { buildServer } = await import("../server.js");
    app = await buildServer();

    supplierToken = (
      await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "supplier.seed@petrospecial.internal", password: DEV_PASSWORD } })
    ).json().accessToken;
    adminToken = (
      await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "admin.seed@petrospecial.internal", password: DEV_PASSWORD } })
    ).json().accessToken;

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();

    adminId = (await dbClient.query("select id from core.identities where email = 'admin.seed@petrospecial.internal'")).rows[0].id;

    const packRes = await dbClient.query<{ id: string }>(
      `select p.id from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where s.slug = 'super-special-10w30'`
    );
    packSizeId = packRes.rows[0]!.id;

    addressId = (
      await app.inject({
        method: "POST",
        url: "/api/v1/me/addresses",
        headers: { authorization: `Bearer ${supplierToken}` },
        payload: { recipientName: "Seed Supplier Warehouse", phone: "+966500000002", line1: "Industrial Area 1", city: "Jeddah", lat: 21.6, lng: 39.1, isDefault: true }
      })
    ).json().id;
  }, 90_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    await dbClient?.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
    await pg?.stop();
  });

  it("FR-AC03-002: an order that would exceed the credit limit is refused before it can ever reach invoicing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/supplier/orders",
      headers: { authorization: `Bearer ${supplierToken}` },
      payload: {
        lines: [{ packSizeId, qty: 2000 }], // far past the SAR 20,000 bronze limit at any real unit price
        paymentMethod: "credit_terms",
        addressId,
        idempotencyKey: "credit-zatca-e2e-over-limit"
      }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CREDIT_LIMIT_EXCEEDED");

    const invoiceCount = await dbClient.query(
      "select count(*)::int as n from credit.invoices where supplier_id = $1",
      [SEED_SUPPLIER_ROW_ID]
    );
    expect(invoiceCount.rows[0].n).toBe(0);
  });

  it("SP-01/04: a within-limit credit order issues a real ZATCA-stamped invoice synchronously", async () => {
    const placed = await app.inject({
      method: "POST",
      url: "/api/v1/supplier/orders",
      headers: { authorization: `Bearer ${supplierToken}` },
      payload: {
        lines: [{ packSizeId, qty: 5 }],
        paymentMethod: "credit_terms",
        addressId,
        idempotencyKey: "credit-zatca-e2e-order-1"
      }
    });
    expect(placed.statusCode).toBe(201);
    const order = placed.json();
    expect(order.status).toBe("confirmed");

    const invoiceRow = await dbClient.query<{
      id: string;
      status: string;
      subtotal: string;
      vat_amount: string;
      total: string;
      open_balance: string;
      zatca_uuid: string | null;
      qr_tlv: string | null;
      crypto_stamp: string | null;
    }>("select id, status, subtotal, vat_amount, total, open_balance, zatca_uuid, qr_tlv, crypto_stamp from credit.invoices where order_id = $1", [
      order.orderId
    ]);
    expect(invoiceRow.rowCount).toBe(1);
    const invoice = invoiceRow.rows[0]!;
    expect(invoice.status).toBe("issued");
    expect(Number(invoice.open_balance)).toBe(Number(invoice.total));
    // VAT is real and server-computed, not client-trusted: 15% of subtotal (D-06),
    // rounded to 2dp the same way orders.place_order/place_wholesale_order round it.
    expect(Number(invoice.vat_amount)).toBe(Math.round(Number(invoice.subtotal) * 0.15 * 100) / 100);
    expect(Number(invoice.total)).toBe(Number(invoice.subtotal) + Number(invoice.vat_amount));
    // The real FATOORA-sim artifacts, not placeholders.
    expect(invoice.zatca_uuid).toBeTruthy();
    expect(invoice.qr_tlv).toBeTruthy();
    expect(invoice.crypto_stamp).toBeTruthy();

    const via = await app.inject({
      method: "GET",
      url: `/api/v1/supplier/invoices/${invoice.id}`,
      headers: { authorization: `Bearer ${supplierToken}` }
    });
    expect(via.statusCode).toBe(200);
    expect(via.json().qrTlv).toBe(invoice.qr_tlv);
  });

  it("SP-05/AC-08: supplier submits payment proof, admin verifies it, invoice settles and the statement reconciles", async () => {
    const invoiceRow = await dbClient.query<{ id: string; total: string }>(
      "select id, total from credit.invoices where supplier_id = $1 order by issued_at desc limit 1",
      [SEED_SUPPLIER_ROW_ID]
    );
    const invoiceId = invoiceRow.rows[0]!.id;
    const total = invoiceRow.rows[0]!.total;

    const proofMediaId = await seedProofMediaId();
    const proofRes = await app.inject({
      method: "POST",
      url: `/api/v1/supplier/invoices/${invoiceId}/pay-proof`,
      headers: { authorization: `Bearer ${supplierToken}` },
      payload: { amount: Number(total), bankRef: "SP-REF-0001", proofMediaId }
    });
    expect(proofRes.statusCode).toBe(202);

    const proofRow = await dbClient.query<{ id: string }>(
      "select id from credit.payment_proofs where invoice_id = $1 and status = 'pending'",
      [invoiceId]
    );
    const proofId = proofRow.rows[0]!.id;

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/v1/admin/finance/bank-transfer/${proofId}/verify`,
      headers: { authorization: `Bearer ${supplierToken}` },
      payload: {}
    });
    expect(forbidden.statusCode).toBe(403);

    const verified = await app.inject({
      method: "POST",
      url: `/api/v1/admin/finance/bank-transfer/${proofId}/verify`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {}
    });
    expect(verified.statusCode).toBe(200);

    const invoiceAfter = await dbClient.query<{ status: string; open_balance: string; paid_amount: string }>(
      "select status, open_balance, paid_amount from credit.invoices where id = $1",
      [invoiceId]
    );
    expect(invoiceAfter.rows[0].status).toBe("paid");
    expect(Number(invoiceAfter.rows[0].open_balance)).toBe(0);
    expect(Number(invoiceAfter.rows[0].paid_amount)).toBe(Number(total));

    const paymentRow = await dbClient.query(
      "select verified_by, amount from credit.payments_received where invoice_id = $1",
      [invoiceId]
    );
    expect(paymentRow.rows[0].verified_by).toBe(adminId);
    expect(Number(paymentRow.rows[0].amount)).toBe(Number(total));

    // A wide window, not exactly "today" in UTC: the ephemeral Postgres
    // session's own timezone (matching the host, +03 here) is what
    // issued_at::date is evaluated against, which can land on a different
    // calendar date than a UTC-computed "today" near midnight.
    const periodStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const periodEnd = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const statement = await app.inject({
      method: "GET",
      url: `/api/v1/supplier/statement?periodStart=${periodStart}&periodEnd=${periodEnd}`,
      headers: { authorization: `Bearer ${supplierToken}` }
    });
    expect(statement.statusCode).toBe(200);
    const stmt = statement.json();
    expect(Number(stmt.invoicesTotal)).toBeGreaterThan(0);
    expect(Number(stmt.paymentsTotal)).toBeGreaterThan(0);
  });

  it("D-14 rule f: the dashboard reports debt, cash custody and goods custody as three separate figures, never summed", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/supplier/dashboard", headers: { authorization: `Bearer ${supplierToken}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toHaveProperty("debt");
    expect(body).toHaveProperty("custodyCash");
    expect(body).toHaveProperty("goodsCustody");
    // Three genuinely distinct objects - not one merged into another, and no
    // fourth "total" field anywhere in the response that would sum them.
    expect(Object.keys(body).sort()).toEqual(["custodyCash", "debt", "goodsCustody"]);
    expect(body).not.toHaveProperty("total");
    expect(body).not.toHaveProperty("combined");

    // The order placed earlier was paid in full, so open debt exposure from
    // it is back near zero - proving exposure tracks real invoice state,
    // not just "an order was ever placed on credit".
    expect(Number(body.debt.exposure)).toBeCloseTo(0, 2);
    expect(Number(body.custodyCash.heldTotal)).toBe(0);
    expect(body.goodsCustody.count).toBe(0);
  });
});
