import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// EP-DL-030/EP-SF-040 (session 2, 2026-08-08): POST /driver/tasks/{id}/pings
// has been callable since S11, and SF-06's GET /orders/{id}/tracking reads
// from the exact same delivery.location_pings table — but nothing in
// apps/driver ever called the write side (confirmed by grepping the whole
// app for geolocation/pings/publish-token: zero hits). Every real delivery
// so far has left the customer's live-tracking screen permanently showing
// lastLocation: null, with no error anywhere to say why. Now wired via
// apps/driver/lib/locationPing.ts's useLocationPing hook. This drives the
// exact payload shape that hook sends, then reads it back through the real
// customer-facing tracking endpoint, proving the whole loop — not just that
// the write endpoint accepts a ping in isolation.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("A driver's location ping is visible on the customer's own tracking screen", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let driverToken: string;
  let customerToken: string;
  let dbClient: Client;
  let taskId: string;
  let orderId: string;

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54361);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-driver-ping-e2e-"));
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
    process.env.EMAIL_MODE = "onscreen";

    const { buildServer } = await import("../server.js");
    app = await buildServer();

    const login = async (email: string) =>
      (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: DEV_PASSWORD } })).json()
        .accessToken;

    driverToken = await login("driver.seed@petrospecial.internal");
    customerToken = await login("customer.seed@petrospecial.internal");

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();

    const customerId = (
      await dbClient.query("select id from core.identities where email = 'customer.seed@petrospecial.internal'")
    ).rows[0].id;
    const driverId = (
      await dbClient.query(
        "select id from delivery.drivers where identity_id = (select id from core.identities where email = 'driver.seed@petrospecial.internal')"
      )
    ).rows[0].id;

    const addressId = (
      await dbClient.query(
        `insert into core.addresses (identity_id, recipient_name, phone, line1) values ($1, 'Customer', '+966500000001', 'Line 1') returning id`,
        [customerId]
      )
    ).rows[0].id;

    orderId = (
      await dbClient.query(
        `insert into orders.orders (user_id, status, payment_method, subtotal, vat_amount, total, address_snapshot, delivery_slot)
         values ($1, 'confirmed', 'cod', 100, 15, 115, '{}'::jsonb, 'same_day') returning id`,
        [customerId]
      )
    ).rows[0].id;

    taskId = (
      await dbClient.query(
        `insert into delivery.delivery_tasks (order_id, order_kind, fulfillment_type, stop_type, address_id, driver_id, status)
         values ($1, 'retail', 'home_delivery', 'b2c_home', $2, $3, 'en_route') returning id`,
        [orderId, addressId, driverId]
      )
    ).rows[0].id;
  }, 90_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    await dbClient?.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
    await pg?.stop();
  });

  it("before any ping, tracking shows the task with no location yet", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/orders/${orderId}/tracking`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lastLocation).toBeNull();
  });

  it("the exact payload useLocationPing sends is accepted, and appears on the customer's tracking read", async () => {
    const at = new Date().toISOString();
    const pingRes = await app.inject({
      method: "POST",
      url: `/api/v1/driver/tasks/${taskId}/pings`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: {
        pings: [{ lat: 24.7136, lng: 46.6753, heading: 90, speed: 12.5, at, clientPingId: "ping-test-1" }]
      }
    });
    expect(pingRes.statusCode).toBe(202);
    expect(pingRes.json().accepted).toBe(1);

    const trackingRes = await app.inject({
      method: "GET",
      url: `/api/v1/orders/${orderId}/tracking`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(trackingRes.statusCode).toBe(200);
    const body = trackingRes.json();
    expect(body.lastLocation).toMatchObject({ lat: 24.7136, lng: 46.6753 });
    expect(body.taskId).toBe(taskId);
  });

  it("a second, later ping replaces the last-known location, not adds to it", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/driver/tasks/${taskId}/pings`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: {
        pings: [
          { lat: 24.72, lng: 46.68, at: new Date(Date.now() + 1000).toISOString(), clientPingId: "ping-test-2" }
        ]
      }
    });
    expect(res.statusCode).toBe(202);

    const trackingRes = await app.inject({
      method: "GET",
      url: `/api/v1/orders/${orderId}/tracking`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(trackingRes.json().lastLocation).toMatchObject({ lat: 24.72, lng: 46.68 });
  });

  it("a driver cannot ping a task that isn't theirs", async () => {
    const otherOrderId = (
      await dbClient.query(
        `insert into orders.orders (user_id, status, payment_method, subtotal, vat_amount, total, address_snapshot, delivery_slot)
         values ((select user_id from orders.orders where id = $1), 'confirmed', 'cod', 50, 7.5, 57.5, '{}'::jsonb, 'same_day') returning id`,
        [orderId]
      )
    ).rows[0].id;
    const unownedTaskId = (
      await dbClient.query(
        `insert into delivery.delivery_tasks (order_id, order_kind, fulfillment_type, stop_type, address_id, status)
         values ($1, 'retail', 'home_delivery', 'b2c_home', (select address_id from delivery.delivery_tasks where id = $2), 'assigned') returning id`,
        [otherOrderId, taskId]
      )
    ).rows[0].id;

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/driver/tasks/${unownedTaskId}/pings`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: { pings: [{ lat: 1, lng: 1, at: new Date().toISOString(), clientPingId: "hijack" }] }
    });
    expect(res.statusCode).toBe(409);
  });
});
