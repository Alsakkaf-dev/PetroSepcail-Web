import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// Critical journey (D-14 rule f): a COD home delivery, from placement
// through OTP-verified proof of delivery, into driver cash custody, through
// both remittance paths this system actually has (driver self-attests at
// shift close; an admin can independently verify a still-held remittance),
// and the shift-close gates that depend on custody being fully cleared.
// delivery.driver_cash_custody and delivery.pods have zero rows in
// production ever - this is the first time any of this has executed
// against a real database.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("Cash custody journey: COD delivery -> custody -> remittance -> shift close (DL-05/07/08, AC-08)", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let customerToken: string;
  let driverToken: string;
  let adminToken: string;
  let driverId: string;
  let adminId: string;
  let shiftId: string;
  let dbClient: Client;
  let addressId: string;

  async function packSizeIdFor(slug: string): Promise<string> {
    const res = await dbClient.query<{ id: string }>(
      `select p.id from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where s.slug = $1`,
      [slug]
    );
    return res.rows[0]!.id;
  }

  async function placeCodOrder(slug: string, idemKey: string) {
    const cartId = (
      await app.inject({ method: "GET", url: "/api/v1/cart", headers: { authorization: `Bearer ${customerToken}` } })
    ).json().cartId;
    const packSizeId = await packSizeIdFor(slug);
    await app.inject({
      method: "POST",
      url: "/api/v1/cart/lines",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { packSizeId, qty: 1 }
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { authorization: `Bearer ${customerToken}`, "idempotency-key": idemKey },
      payload: { cartId, addressId, slot: "next_am", paymentMethod: "cod" }
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { orderId: string; status: string; total: string; codAmount: string };
  }

  async function seedPhotoMediaId(): Promise<string> {
    const row = await dbClient.query<{ id: string }>(
      `insert into core.media_objects (bucket, object_key, content_type, size_bytes, purpose)
       values ('ps-pod', $1, 'image/png', 4, 'pod_photo') returning id`,
      [`pod/${randomBytes(8).toString("hex")}.png`]
    );
    return row.rows[0]!.id;
  }

  async function dispatchAndDeliver(orderId: string, codAmountStr: string, clientActionPrefix: string) {
    const codAmount = Number(codAmountStr);
    // No consumer worker runs in this test - dispatch is normally EV-PC-013's
    // own outbox consumer, invoked here directly the same way the real
    // consumer would call it, mirroring how other e2e suites skip
    // background-worker-only paths (e.g. orders.e2e.test.ts seeding
    // orders.payments directly for a piece proven elsewhere).
    await dbClient.query("select delivery.dispatch_order($1, gen_random_uuid())", [orderId]);

    const manifest = await app.inject({ method: "GET", url: "/api/v1/driver/manifest", headers: { authorization: `Bearer ${driverToken}` } });
    const stop = manifest.json().stops.find((s: { orderId: string }) => s.orderId === orderId);
    expect(stop).toBeTruthy();
    const taskId = stop.taskId;

    const accept = await app.inject({ method: "POST", url: `/api/v1/driver/tasks/${taskId}/accept`, headers: { authorization: `Bearer ${driverToken}` } });
    expect(accept.statusCode).toBe(200);

    for (const to of ["at_pickup", "picked_up", "en_route", "arrived"] as const) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/driver/tasks/${taskId}/transition`,
        headers: { authorization: `Bearer ${driverToken}` },
        payload: { to, clientActionId: `${clientActionPrefix}-${to}` }
      });
      expect(res.statusCode).toBe(200);
    }

    const orderDetail = await app.inject({ method: "GET", url: `/api/v1/orders/${orderId}`, headers: { authorization: `Bearer ${customerToken}` } });
    const realOtp = orderDetail.json().deliveryOtp;
    expect(realOtp).toBeTruthy();

    const photoMediaId = await seedPhotoMediaId();

    const wrongOtp = await app.inject({
      method: "POST",
      url: `/api/v1/driver/tasks/${taskId}/pod`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: {
        photoMediaId,
        otp: realOtp === "0000" ? "1111" : "0000",
        collectorKind: "customer",
        codCollectedAmount: codAmount,
        clientActionId: `${clientActionPrefix}-pod-wrong`
      }
    });
    expect(wrongOtp.statusCode).toBe(422);
    expect(wrongOtp.json().error.code).toBe("OTP_MISMATCH");

    const pod = await app.inject({
      method: "POST",
      url: `/api/v1/driver/tasks/${taskId}/pod`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: {
        photoMediaId,
        otp: realOtp,
        collectorKind: "customer",
        codCollectedAmount: codAmount,
        clientActionId: `${clientActionPrefix}-pod-correct`
      }
    });
    expect(pod.statusCode).toBe(200);
    expect(pod.json().status).toBe("delivered");

    return taskId;
  }

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54354);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-custody-e2e-"));
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
      await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "customer.seed@petrospecial.internal", password: DEV_PASSWORD } })
    ).json().accessToken;
    driverToken = (
      await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "driver.seed@petrospecial.internal", password: DEV_PASSWORD } })
    ).json().accessToken;
    adminToken = (
      await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "admin.seed@petrospecial.internal", password: DEV_PASSWORD } })
    ).json().accessToken;

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();

    // delivery.shifts/driver_cash_custody.driver_id references delivery.drivers.id
    // (the driver profile), not core.identities.id - resolved via the seeded
    // role_grants.driver_id backfill (0044), same value the JWT's driver_id
    // claim carries.
    const driverIdentityId = (await dbClient.query("select id from core.identities where email = 'driver.seed@petrospecial.internal'")).rows[0].id;
    driverId = (await dbClient.query("select driver_id from core.role_grants where identity_id = $1 and role = 'driver'", [driverIdentityId])).rows[0]
      .driver_id;
    adminId = (await dbClient.query("select id from core.identities where email = 'admin.seed@petrospecial.internal'")).rows[0].id;
    shiftId = (await dbClient.query("select id from delivery.shifts where driver_id = $1 and status = 'open'", [driverId])).rows[0].id;

    addressId = (
      await app.inject({
        method: "POST",
        url: "/api/v1/me/addresses",
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { recipientName: "Test Customer", phone: "+966500000001", line1: "Test Street 1", city: "Jeddah", lat: 21.5, lng: 39.2, isDefault: true }
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

  // Both deliveries happen while the shift is still 'open' - dispatch's own
  // eligibility check requires that, so reconciling (which moves the shift
  // to 'reconciling') must wait until every delivery for this journey is done.
  let orderBId: string;
  let orderBCodAmount: string;

  it("FR-DL05: two COD deliveries each create their own held custody row, correctly amounted", async () => {
    const orderA = await placeCodOrder("super-special-10w30", "custody-e2e-order-a");
    await dispatchAndDeliver(orderA.orderId, orderA.codAmount, "a");

    const orderB = await placeCodOrder("super-special-20w50", "custody-e2e-order-b");
    orderBId = orderB.orderId;
    orderBCodAmount = orderB.codAmount;
    await dispatchAndDeliver(orderB.orderId, orderB.codAmount, "b");

    const custodyA = await dbClient.query(
      "select id, status, amount from delivery.driver_cash_custody where driver_id = $1 and order_id = $2",
      [driverId, orderA.orderId]
    );
    expect(custodyA.rows[0].status).toBe("held");
    expect(Number(custodyA.rows[0].amount)).toBe(Number(orderA.codAmount));

    const payment = await dbClient.query("select method, status from orders.payments where order_id = $1", [orderA.orderId]);
    expect(payment.rows[0]).toEqual({ method: "cod", status: "collected" });

    const orderRow = await dbClient.query("select status from orders.orders where id = $1", [orderA.orderId]);
    expect(orderRow.rows[0].status).toBe("delivered");

    const heldCount = await dbClient.query(
      "select count(*)::int as n from delivery.driver_cash_custody where driver_id = $1 and status = 'held'",
      [driverId]
    );
    expect(heldCount.rows[0].n).toBe(2);
  });

  it("FR-DL07: shift cannot close while any custody is held", async () => {
    // Reconcile with an empty count (valid input, zero variance by
    // construction) purely to reach 'reconciling', the state close_shift
    // requires - the variance gate itself isn't this test's concern.
    const reconcile = await app.inject({
      method: "POST",
      url: `/api/v1/driver/shifts/${shiftId}/reconcile`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: { counted: [] }
    });
    expect(reconcile.statusCode).toBe(200);

    const blockedClose = await app.inject({
      method: "POST",
      url: `/api/v1/driver/shifts/${shiftId}/close`,
      headers: { authorization: `Bearer ${driverToken}` }
    });
    expect(blockedClose.statusCode).toBe(409);
    expect(blockedClose.json().error.code).toBe("CUSTODY_OPEN");
  });

  it("FR-AC08-003: an admin can independently verify a still-held custody remittance, amount-matched, under their own identity", async () => {
    const custodyB = await dbClient.query(
      "select id from delivery.driver_cash_custody where driver_id = $1 and order_id = $2",
      [driverId, orderBId]
    );
    const custodyId = custodyB.rows[0].id;
    const orderBCod = orderBCodAmount;

    const wrongAmount = await app.inject({
      method: "POST",
      url: `/api/v1/admin/finance/custody/${custodyId}/verify-remittance`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { amount: Number(orderBCod) + 1 }
    });
    expect(wrongAmount.statusCode).toBe(409);
    expect(wrongAmount.json().error.code).toBe("CUSTODY_MISMATCH");

    const stillHeld = await dbClient.query("select status from delivery.driver_cash_custody where id = $1", [custodyId]);
    expect(stillHeld.rows[0].status).toBe("held");

    const verified = await app.inject({
      method: "POST",
      url: `/api/v1/admin/finance/custody/${custodyId}/verify-remittance`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { amount: Number(orderBCod) }
    });
    expect(verified.statusCode).toBe(200);

    const remitted = await dbClient.query("select status, remittance_ref from delivery.driver_cash_custody where id = $1", [custodyId]);
    expect(remitted.rows[0].status).toBe("remitted");
    expect(remitted.rows[0].remittance_ref).toBeTruthy();

    const audit = await dbClient.query(
      "select actor_id, actor_role from audit.audit_log where action = 'custody.driver.remitted' and resource_id = $1",
      [custodyId]
    );
    expect(audit.rows[0].actor_id).toBe(adminId);
    expect(audit.rows[0].actor_role).toBe("admin");
  });

  it("FR-DL07-006: driver self-attested remit clears the remaining held custody; shift close now succeeds", async () => {
    // Order A's custody is still held from the first test (order B's was
    // resolved via admin verify above, not driver remit).
    const stillHeldBefore = await dbClient.query(
      "select count(*)::int as n from delivery.driver_cash_custody where driver_id = $1 and status = 'held'",
      [driverId]
    );
    expect(stillHeldBefore.rows[0].n).toBe(1);

    const remit = await app.inject({
      method: "POST",
      url: `/api/v1/driver/shifts/${shiftId}/remit-custody`,
      headers: { authorization: `Bearer ${driverToken}` }
    });
    expect(remit.statusCode).toBe(200);
    expect(remit.json().remitted).toBe(1);

    const stillHeldAfter = await dbClient.query(
      "select count(*)::int as n from delivery.driver_cash_custody where driver_id = $1 and status = 'held'",
      [driverId]
    );
    expect(stillHeldAfter.rows[0].n).toBe(0);

    const close = await app.inject({
      method: "POST",
      url: `/api/v1/driver/shifts/${shiftId}/close`,
      headers: { authorization: `Bearer ${driverToken}` }
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().status).toBe("closed");
  });
});
