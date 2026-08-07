import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// Critical journey: a driver goes offline mid-delivery, the offline write
// queue (apps/driver/lib/actionQueue.ts, unit-tested there) replays a
// transition and a POD capture keyed by clientActionId once connectivity
// returns. This suite proves the SERVER half of that guarantee directly:
// calling the same transition or POD twice with the same clientActionId -
// exactly what a retried offline action looks like on the wire - lands
// exactly once, never zero times, never twice.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("Driver offline replay lands exactly once (client_action_id idempotency, DL-04/05)", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let customerToken: string;
  let driverToken: string;
  let driverId: string;
  let dbClient: Client;
  let addressId: string;
  let taskId: string;
  let orderId: string;

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54356);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-offline-e2e-"));
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

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();

    const driverIdentityId = (await dbClient.query("select id from core.identities where email = 'driver.seed@petrospecial.internal'")).rows[0].id;
    driverId = (await dbClient.query("select driver_id from core.role_grants where identity_id = $1 and role = 'driver'", [driverIdentityId])).rows[0]
      .driver_id;

    addressId = (
      await app.inject({
        method: "POST",
        url: "/api/v1/me/addresses",
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { recipientName: "Test Customer", phone: "+966500000001", line1: "Test Street 1", city: "Jeddah", lat: 21.5, lng: 39.2, isDefault: true }
      })
    ).json().id;

    const packSizeId = (
      await dbClient.query<{ id: string }>(
        `select p.id from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where s.slug = 'super-special-10w30'`
      )
    ).rows[0]!.id;
    const cartId = (await app.inject({ method: "GET", url: "/api/v1/cart", headers: { authorization: `Bearer ${customerToken}` } })).json().cartId;
    await app.inject({
      method: "POST",
      url: "/api/v1/cart/lines",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { packSizeId, qty: 1 }
    });
    const placed = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: { authorization: `Bearer ${customerToken}`, "idempotency-key": "offline-e2e-order-1" },
      payload: { cartId, addressId, slot: "next_am", paymentMethod: "cod" }
    });
    orderId = placed.json().orderId;

    await dbClient.query("select delivery.dispatch_order($1, gen_random_uuid())", [orderId]);
    const manifest = await app.inject({ method: "GET", url: "/api/v1/driver/manifest", headers: { authorization: `Bearer ${driverToken}` } });
    taskId = manifest.json().stops.find((s: { orderId: string }) => s.orderId === orderId).taskId;
    await app.inject({ method: "POST", url: `/api/v1/driver/tasks/${taskId}/accept`, headers: { authorization: `Bearer ${driverToken}` } });
  }, 90_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    await dbClient?.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
    await pg?.stop();
  });

  it("FR-DL03/04: replaying the same transition with the same clientActionId is a no-op, not a second event", async () => {
    const clientActionId = "offline-e2e-transition-at-pickup";

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/driver/tasks/${taskId}/transition`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: { to: "at_pickup", clientActionId }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("at_pickup");

    // The offline queue replays the exact same request again once
    // connectivity returns, unaware the first attempt already landed.
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/driver/tasks/${taskId}/transition`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: { to: "at_pickup", clientActionId }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().status).toBe("at_pickup");

    const events = await dbClient.query(
      "select count(*)::int as n from delivery.task_events where task_id = $1 and client_action_id = $2",
      [taskId, clientActionId]
    );
    expect(events.rows[0].n).toBe(1);

    const taskRow = await dbClient.query("select status from delivery.delivery_tasks where id = $1", [taskId]);
    expect(taskRow.rows[0].status).toBe("at_pickup");
  });

  it("FR-DL05: replaying the same POD capture with the same clientActionId creates exactly one proof, one custody entry, not two", async () => {
    for (const to of ["picked_up", "en_route", "arrived"] as const) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/driver/tasks/${taskId}/transition`,
        headers: { authorization: `Bearer ${driverToken}` },
        payload: { to, clientActionId: `offline-e2e-transition-${to}` }
      });
      expect(res.statusCode).toBe(200);
    }

    const orderDetail = await app.inject({ method: "GET", url: `/api/v1/orders/${orderId}`, headers: { authorization: `Bearer ${customerToken}` } });
    const otp = orderDetail.json().deliveryOtp;

    const photoMediaId = (
      await dbClient.query<{ id: string }>(
        `insert into core.media_objects (bucket, object_key, content_type, size_bytes, purpose)
         values ('ps-pod', $1, 'image/png', 4, 'pod_photo') returning id`,
        [`pod/${randomBytes(8).toString("hex")}.png`]
      )
    ).rows[0]!.id;

    const podClientActionId = "offline-e2e-pod-1";
    const podPayload = {
      photoMediaId,
      otp,
      collectorKind: "customer" as const,
      codCollectedAmount: Number(orderDetail.json().codAmount),
      clientActionId: podClientActionId
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/driver/tasks/${taskId}/pod`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: podPayload
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("delivered");

    // Same scenario as above: the driver's device retries the exact same
    // POD submission after regaining connectivity, unaware it already
    // landed while they were still offline.
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/driver/tasks/${taskId}/pod`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: podPayload
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().status).toBe("delivered");

    const podCount = await dbClient.query("select count(*)::int as n from delivery.pods where task_id = $1", [taskId]);
    expect(podCount.rows[0].n).toBe(1);

    const custodyCount = await dbClient.query(
      "select count(*)::int as n from delivery.driver_cash_custody where driver_id = $1 and order_id = $2",
      [driverId, orderId]
    );
    expect(custodyCount.rows[0].n).toBe(1);

    const paymentCount = await dbClient.query("select count(*)::int as n from orders.payments where order_id = $1", [orderId]);
    expect(paymentCount.rows[0].n).toBe(1);
  });
});
