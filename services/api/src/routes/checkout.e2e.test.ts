import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";
import { startEphemeralMinio, type EphemeralMinio } from "../testHelpers/ephemeralMinio.js";

// SF-03/SF-04 (S08): real Postgres + S3-compatible storage, same pattern as
// catalog.e2e.test.ts / me.e2e.test.ts. Proves the cart -> quote ->
// place-order (COD + bank transfer) -> proof flow against the actual
// 23-SKU seed and the real orders.place_order DB function.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("Cart + Checkout (SF-03/SF-04)", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  let minio: EphemeralMinio;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let customerToken: string;
  let dbClient: Client;
  let addressId: string;
  let packSizeId: string; // super-special-10w30's pack size

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54345);
    const dbUrl = pg.dbUrl;

    minio = await startEphemeralMinio(54346);

    process.env.MINIO_ENDPOINT = "127.0.0.1";
    process.env.MINIO_API_PORT = String(minio.port);
    process.env.MINIO_USE_SSL = "false";
    process.env.MINIO_ROOT_USER = minio.accessKey;
    process.env.MINIO_ROOT_PASSWORD = minio.secretKey;
    process.env.MINIO_BUCKET_MEDIA = "ps-media";
    process.env.MINIO_BUCKET_INVOICES = "ps-invoices";
    process.env.MINIO_BUCKET_POD = "ps-pod";
    process.env.PUBLIC_BASE_URL = "https://localhost";

    dir = mkdtempSync(path.join(tmpdir(), "ps-checkout-e2e-"));
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

    const customerLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "customer.seed@petrospecial.internal", password: DEV_PASSWORD }
    });
    customerToken = customerLogin.json().accessToken;

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();

    const packRes = await dbClient.query<{ id: string }>(
      `select p.id from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where s.slug = 'super-special-10w30'`
    );
    packSizeId = packRes.rows[0]!.id;

    const addressRes = await app.inject({
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
    });
    addressId = addressRes.json().id;
  }, 90_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    await dbClient?.end();
    rmSync(dir, { recursive: true, force: true });
    await minio?.stop();
    await pg?.stop();
  });

  it("TC-SF03-001..004: adding a line creates a cart with server-authoritative totals", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/cart/lines",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { packSizeId, qty: 2 }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.line.qty).toBe(2);
    expect(Number(body.totals.total)).toBeGreaterThan(0);

    const cart = await app.inject({ method: "GET", url: "/api/v1/cart", headers: { authorization: `Bearer ${customerToken}` } });
    expect(cart.json().lines).toHaveLength(1);
    expect(cart.json().lines[0].qty).toBe(2);
  });

  it("TC-SF03-005: updating quantity recomputes totals server-side", async () => {
    const cart = await app.inject({ method: "GET", url: "/api/v1/cart", headers: { authorization: `Bearer ${customerToken}` } });
    const lineId = cart.json().lines[0].lineId;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/cart/lines/${lineId}`,
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { qty: 3 }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().line.qty).toBe(3);
  });

  it("TC-SF03-007..009: an invalid coupon never throws, never discounts (LE-02 stub)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/cart/coupon",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { code: "ANYCODE" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    expect(typeof res.json().reason).toBe("string");
  });

  it("TC-SF04-003..005: checkout quote for an in-radius address returns fee and slots", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/quote",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { addressId }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.inRadius).toBe(true);
    expect(body.slots.length).toBeGreaterThan(0);
  });

  it("TC-SF04-001/009/012..017: places a COD order, reserves stock, emits EV-PC-010/012", async () => {
    const idemKey = "test-cod-order-1";
    const cartId = (await app.inject({ method: "GET", url: "/api/v1/cart", headers: { authorization: `Bearer ${customerToken}` } })).json()
      .cartId;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { authorization: `Bearer ${customerToken}`, "idempotency-key": idemKey },
      payload: { cartId, addressId, slot: "next_am", paymentMethod: "cod" }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("confirmed");
    expect(Number(body.total)).toBeGreaterThan(0);
    expect(body.codAmount).toBe(body.total);

    const events = await dbClient.query("select name from core.outbox where payload->>'order_id' = $1 order by occurred_at", [
      body.orderId
    ]);
    expect(events.rows.map((r: { name: string }) => r.name)).toEqual(
      expect.arrayContaining(["orders.order.placed", "orders.order.confirmed"])
    );

    const inv = await dbClient.query<{ reserved: number }>("select reserved from catalog.inventory where pack_size_id = $1", [
      packSizeId
    ]);
    expect(inv.rows[0]!.reserved).toBeGreaterThanOrEqual(3);

    // TC-SF04-008 AC2: a retried Idempotency-Key (same cart, now 'converted')
    // returns the SAME order, not a second one — proves the route's cart
    // pre-check doesn't block a legitimate replay (real bug found live: it
    // used to require the cart to still be 'open').
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { authorization: `Bearer ${customerToken}`, "idempotency-key": idemKey },
      payload: { cartId, addressId, slot: "next_am", paymentMethod: "cod" }
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().orderId).toBe(body.orderId);
  });

  it("TC-SF04-011: COD is refused above the cod_ceiling; bank transfer is required instead", async () => {
    // A dedicated, untouched pack size — avoids any stock coupling with
    // other tests' reservations. 90 units of a 22 SAR pack comfortably
    // clears cod_ceiling (1500) while staying within the 100-unit seed.
    const dedicatedPack = await dbClient.query<{ id: string }>(
      `select p.id from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where s.slug = 'raval-20w50'`
    );
    const ravalPackId = dedicatedPack.rows[0]!.id;

    const cartRes = await app.inject({ method: "GET", url: "/api/v1/cart", headers: { authorization: `Bearer ${customerToken}` } });
    const cartId = cartRes.json().cartId;
    await app.inject({
      method: "POST",
      url: "/api/v1/cart/lines",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { packSizeId: ravalPackId, qty: 90 }
    });

    const codAttempt = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { authorization: `Bearer ${customerToken}`, "idempotency-key": "test-cod-over-limit" },
      payload: { cartId, addressId, slot: "next_am", paymentMethod: "cod" }
    });
    expect(codAttempt.statusCode).toBe(422);
    expect(codAttempt.json().error.code).toBe("COD_LIMIT_EXCEEDED");

    // Real bug regression guard: a rejected place_order call must not leave
    // a leaked stock reservation behind (the ApiError-commits-anyway trap —
    // see routes/checkout.ts's comment on this exact point).
    const invAfterReject = await dbClient.query<{ reserved: number }>(
      "select reserved from catalog.inventory where pack_size_id = $1",
      [ravalPackId]
    );
    expect(invAfterReject.rows[0]!.reserved).toBe(0);

    const bankRes = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { authorization: `Bearer ${customerToken}`, "idempotency-key": "test-bank-transfer-1" },
      payload: { cartId, addressId, slot: "next_am", paymentMethod: "bank_transfer" }
    });
    expect(bankRes.statusCode).toBe(201);
    const bankBody = bankRes.json();
    expect(bankBody.status).toBe("pending_payment");
    expect(bankBody.payTo.iban).toBeTruthy();
    expect(bankBody.payWindowHours).toBe(48);

    // EP-SF-023: submitting bank-transfer proof
    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/v1/media/upload-url",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { purpose: "transfer_proof", contentType: "image/png", sizeBytes: 4 }
    });
    const { objectKey } = uploadRes.json();
    const mediaRow = await dbClient.query<{ id: string }>("select id from core.media_objects where object_key = $1", [objectKey]);

    const proofRes = await app.inject({
      method: "POST",
      url: `/api/v1/orders/${bankBody.orderId}/bank-transfer-proof`,
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { amount: bankBody.total, bankRef: "REF12345", proofMediaId: mediaRow.rows[0]!.id }
    });
    expect(proofRes.statusCode).toBe(202);
    expect(proofRes.json().status).toBe("pending_verification");

    const event = await dbClient.query("select payload from core.outbox where name = 'payments.bank_transfer.proof_submitted' order by occurred_at desc limit 1");
    expect(event.rows[0].payload.order_id_or_invoice_id).toBe(bankBody.orderId);
  });

  it("TC-SF04-023/024: a stock race yields CONFLICT for the losing request", async () => {
    // gear-atf has 100 units seeded; two concurrent 60-unit orders can't both succeed.
    const packRes = await dbClient.query<{ id: string }>(
      `select p.id from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where s.slug = 'gear-atf'`
    );
    const gearPackId = packRes.rows[0]!.id;

    await app.inject({
      method: "POST",
      url: "/api/v1/cart/lines",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { packSizeId: gearPackId, qty: 60 }
    });
    const cartId = (await app.inject({ method: "GET", url: "/api/v1/cart", headers: { authorization: `Bearer ${customerToken}` } })).json()
      .cartId;

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { authorization: `Bearer ${customerToken}`, "idempotency-key": "race-1" },
      payload: { cartId, addressId, slot: "next_am", paymentMethod: "bank_transfer" }
    });
    expect(first.statusCode).toBe(201); // 60 of 100 succeeds

    // Same cart is now converted; a second 60-unit cart against the same (now ~40 remaining) pack size must fail.
    await app.inject({
      method: "POST",
      url: "/api/v1/cart/lines",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { packSizeId: gearPackId, qty: 60 }
    });
    const cartId2 = (await app.inject({ method: "GET", url: "/api/v1/cart", headers: { authorization: `Bearer ${customerToken}` } })).json()
      .cartId;
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { authorization: `Bearer ${customerToken}`, "idempotency-key": "race-2" },
      payload: { cartId: cartId2, addressId, slot: "next_am", paymentMethod: "bank_transfer" }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("CONFLICT");
  });
});
