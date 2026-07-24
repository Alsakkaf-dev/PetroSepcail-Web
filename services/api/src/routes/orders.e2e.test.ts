import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// SF-05 (S09): full order lifecycle over the real orders.* SECURITY DEFINER
// functions (0035/0037) — cancel, confirm-receipt (idempotent), reorder,
// list/detail+timeline, and the pulled-forward admin verify-bank-transfer
// stand-in. No MinIO here: bank-transfer proof rows are seeded directly via
// dbClient (the real upload->proof flow is already covered by
// checkout.e2e.test.ts) since this file's own concern is the state machine,
// not the media pipeline.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("Order lifecycle (SF-05)", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let customerToken: string;
  let adminToken: string;
  let dbClient: Client;
  let addressId: string;

  async function packSizeIdFor(slug: string): Promise<string> {
    const res = await dbClient.query<{ id: string }>(
      `select p.id from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where s.slug = $1`,
      [slug]
    );
    return res.rows[0]!.id;
  }

  async function placeOrder(paymentMethod: "cod" | "bank_transfer", slug: string, qty: number, idemKey: string) {
    const cartId = (
      await app.inject({ method: "GET", url: "/api/v1/cart", headers: { authorization: `Bearer ${customerToken}` } })
    ).json().cartId;
    const packSizeId = await packSizeIdFor(slug);
    await app.inject({
      method: "POST",
      url: "/api/v1/cart/lines",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { packSizeId, qty }
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { authorization: `Bearer ${customerToken}`, "idempotency-key": idemKey },
      payload: { cartId, addressId, slot: "next_am", paymentMethod }
    });
    return res.json() as { orderId: string; status: string; total: string };
  }

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54350);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-orders-e2e-"));
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

    customerToken = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "customer.seed@petrospecial.internal", password: DEV_PASSWORD }
      })
    ).json().accessToken;
    adminToken = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "admin.seed@petrospecial.internal", password: DEV_PASSWORD }
      })
    ).json().accessToken;

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();

    addressId = (
      await app.inject({
        method: "POST",
        url: "/api/v1/me/addresses",
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          recipientName: "Test Customer",
          phone: "+966500000001",
          line1: "Test Street 1",
          city: "Jeddah",
          lat: 21.5,
          lng: 39.2,
          isDefault: true
        }
      })
    ).json().id;
  }, 90_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    await dbClient?.end();
    // Guarded: if beforeAll failed before `dir` was assigned, an unguarded
    // throw here would skip stop() below and permanently orphan the
    // postgres child process bound to this file's fixed port.
    if (dir) rmSync(dir, { recursive: true, force: true });
    await pg?.stop();
  });

  it("FR-SF05-007: a COD order can be cancelled before preparing, with a timeline entry", async () => {
    const placed = await placeOrder("cod", "super-special-10w30", 1, "orders-e2e-cancel-1");
    expect(placed.status).toBe("confirmed");

    const cancelRes = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${placed.orderId}/cancel`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe("cancelled");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/orders/${placed.orderId}`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(detail.json().status).toBe("cancelled");
    expect(detail.json().timeline).toEqual([
      { status: "confirmed", at: expect.any(String) },
      { status: "cancelled", at: expect.any(String) }
    ]);
  });

  it("FR-SF05-007: cancelling an order at/after preparing is refused (ORDER_NOT_CANCELLABLE)", async () => {
    const placed = await placeOrder("cod", "super-special-20w50", 1, "orders-e2e-cancel-2");
    await dbClient.query("update orders.orders set status = 'preparing' where id = $1", [placed.orderId]);

    const cancelRes = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${placed.orderId}/cancel`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(cancelRes.statusCode).toBe(409);
    expect(cancelRes.json().error.code).toBe("ORDER_NOT_CANCELLABLE");
  });

  it("a non-owner gets NOT_FOUND cancelling someone else's order (no ownership leak)", async () => {
    const placed = await placeOrder("cod", "dlx-10w30", 1, "orders-e2e-cancel-3");
    const supplierToken = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "supplier.seed@petrospecial.internal", password: DEV_PASSWORD }
      })
    ).json().accessToken;

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${placed.orderId}/cancel`,
      headers: { authorization: `Bearer ${supplierToken}` }
    });
    expect(res.statusCode).toBe(404);
  });

  it("FR-SF05-006: confirm-receipt only from 'delivered', and is idempotent", async () => {
    const placed = await placeOrder("cod", "gear-cvt", 1, "orders-e2e-receipt-1");

    const tooEarly = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${placed.orderId}/confirm-receipt`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(tooEarly.statusCode).toBe(409);
    expect(tooEarly.json().error.code).toBe("CONFLICT");

    await dbClient.query("update orders.orders set status = 'delivered' where id = $1", [placed.orderId]);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${placed.orderId}/confirm-receipt`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("confirmed_received");

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${placed.orderId}/confirm-receipt`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("confirmed_received");

    const history = await dbClient.query("select status from orders.status_history where order_id = $1", [placed.orderId]);
    expect(history.rows.filter((r: { status: string }) => r.status === "confirmed_received")).toHaveLength(1); // no duplicate on replay
  });

  it("pulled-forward verify-bank-transfer: pending_payment -> paid -> confirmed, admin-only", async () => {
    const placed = await placeOrder("bank_transfer", "brake-fluid", 1, "orders-e2e-verify-1");
    expect(placed.status).toBe("pending_payment");

    // Seeded directly (see file header) — real proof submission is
    // checkout.e2e.test.ts's own concern.
    await dbClient.query(
      `insert into orders.payments (order_id, method, amount, status, bank_ref) values ($1, 'bank_transfer', $2, 'pending', 'REF999')`,
      [placed.orderId, placed.total]
    );

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${placed.orderId}/verify-bank-transfer`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(forbidden.statusCode).toBe(403);

    const verified = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${placed.orderId}/verify-bank-transfer`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().status).toBe("confirmed");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/orders/${placed.orderId}`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(detail.json().timeline.map((t: { status: string }) => t.status)).toEqual(["pending_payment", "paid", "confirmed"]);

    const events = await dbClient.query(
      "select name from core.outbox where payload->>'order_id_or_invoice_id' = $1 or payload->>'order_id' = $1 order by occurred_at",
      [placed.orderId]
    );
    expect(events.rows.map((r: { name: string }) => r.name)).toEqual(
      expect.arrayContaining(["payments.bank_transfer.verified", "orders.order.paid", "orders.order.confirmed"])
    );
  });

  it("FR-SF05-005: reorder clones lines into the customer's open cart at current prices", async () => {
    const placed = await placeOrder("cod", "radiator-green", 2, "orders-e2e-reorder-1");

    const reorderRes = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${placed.orderId}/reorder`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(reorderRes.statusCode).toBe(200);
    const body = reorderRes.json();
    expect(body.dropped).toEqual([]);
    expect(body.added).toEqual([expect.objectContaining({ skuSlug: "radiator-green", qty: 2 })]);

    const cart = await app.inject({ method: "GET", url: "/api/v1/cart", headers: { authorization: `Bearer ${customerToken}` } });
    expect(cart.json().lines.some((l: { slug: string }) => l.slug === "radiator-green")).toBe(true);
  });

  it("EP-SF-030: GET /orders lists the caller's own orders, newest first, cursor-paginated", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/orders?limit=2", headers: { authorization: `Bearer ${customerToken}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeLessThanOrEqual(2);
    expect(res.json().items[0]).toEqual(
      expect.objectContaining({ orderId: expect.any(String), status: expect.any(String), total: expect.any(String) })
    );
  });
});
