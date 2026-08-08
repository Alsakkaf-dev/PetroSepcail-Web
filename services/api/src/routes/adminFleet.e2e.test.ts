import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// AC-09 (S18): every route in adminFleet.ts except audit-cadence shared the
// same coarse `driver_location`/`delivery_task` resource permission a
// narrower customer/supplier/driver case also holds (04-roles §3: a
// customer may read a driver's location while their own order is en_route;
// a driver may update their own task) — with no additional role check on
// the routes actually meant to be admin/super_admin-only. Found while
// building this session's own fleet-reassignment screen, the first real UI
// caller any of these four routes has ever had. Drives the real HTTP
// routes end to end so it fails exactly the way a real customer/driver
// request would have.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("AC-09 fleet routes are genuinely admin-only, and reassignment works end to end", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let adminToken: string;
  let customerToken: string;
  let supplierToken: string;
  let driverToken: string;
  let dbClient: Client;
  let adminId: string;
  let unassignedTaskId: string;
  let assignedTaskId: string;
  let driverAId: string;
  let driverBId: string;

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54358);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-admin-fleet-e2e-"));
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

    adminToken = await login("admin.seed@petrospecial.internal");
    customerToken = await login("customer.seed@petrospecial.internal");
    supplierToken = await login("supplier.seed@petrospecial.internal");
    driverToken = await login("driver.seed@petrospecial.internal");

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();

    adminId = (await dbClient.query("select id from core.identities where email = 'admin.seed@petrospecial.internal'")).rows[0]
      .id;
    const customerId = (
      await dbClient.query("select id from core.identities where email = 'customer.seed@petrospecial.internal'")
    ).rows[0].id;
    driverAId = (await dbClient.query("select id from delivery.drivers where identity_id = (select id from core.identities where email = 'driver.seed@petrospecial.internal')"))
      .rows[0].id;

    // A second driver, purely as the reassignment target.
    const driverBIdentity = (
      await dbClient.query(
        `insert into core.identities (full_name, email, phone, password_hash, status)
         values ('RLS Driver B', 'fleet-driver-b@petrospecial.internal', '+966500000901', 'x', 'active') returning id`
      )
    ).rows[0].id;
    driverBId = (
      await dbClient.query("insert into delivery.drivers (identity_id) values ($1) returning id", [driverBIdentity])
    ).rows[0].id;

    const addressId = (
      await dbClient.query(
        `insert into core.addresses (identity_id, recipient_name, phone, line1) values ($1, 'Customer', '+966500000001', 'Line 1') returning id`,
        [customerId]
      )
    ).rows[0].id;

    const makeOrder = async () =>
      (
        await dbClient.query(
          `insert into orders.orders (user_id, status, payment_method, subtotal, vat_amount, total, address_snapshot, delivery_slot)
           values ($1, 'confirmed', 'cod', 100, 15, 115, '{}'::jsonb, 'same_day') returning id`,
          [customerId]
        )
      ).rows[0].id;

    const unassignedOrderId = await makeOrder();
    unassignedTaskId = (
      await dbClient.query(
        `insert into delivery.delivery_tasks (order_id, order_kind, fulfillment_type, stop_type, address_id, status)
         values ($1, 'retail', 'home_delivery', 'b2c_home', $2, 'assigned') returning id`,
        [unassignedOrderId, addressId]
      )
    ).rows[0].id;

    const assignedOrderId = await makeOrder();
    assignedTaskId = (
      await dbClient.query(
        `insert into delivery.delivery_tasks (order_id, order_kind, fulfillment_type, stop_type, address_id, driver_id, status)
         values ($1, 'retail', 'home_delivery', 'b2c_home', $2, $3, 'assigned') returning id`,
        [assignedOrderId, addressId, driverAId]
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

  it("GET /admin/fleet/map-token: refuses a customer and a supplier, allows an admin", async () => {
    const asCustomer = await app.inject({
      method: "GET",
      url: "/api/v1/admin/fleet/map-token",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(asCustomer.statusCode).toBe(403);

    const asSupplier = await app.inject({
      method: "GET",
      url: "/api/v1/admin/fleet/map-token",
      headers: { authorization: `Bearer ${supplierToken}` }
    });
    expect(asSupplier.statusCode).toBe(403);

    const asAdmin = await app.inject({
      method: "GET",
      url: "/api/v1/admin/fleet/map-token",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json().channel).toBe("admin:fleet");
  });

  it("GET /admin/fleet/kpis: refuses a customer, allows an admin", async () => {
    const asCustomer = await app.inject({
      method: "GET",
      url: "/api/v1/admin/fleet/kpis",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(asCustomer.statusCode).toBe(403);

    const asAdmin = await app.inject({
      method: "GET",
      url: "/api/v1/admin/fleet/kpis",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(asAdmin.statusCode).toBe(200);
  });

  it("GET /admin/fleet/alerts: refuses a supplier, allows an admin and surfaces the unassigned task", async () => {
    const asSupplier = await app.inject({
      method: "GET",
      url: "/api/v1/admin/fleet/alerts",
      headers: { authorization: `Bearer ${supplierToken}` }
    });
    expect(asSupplier.statusCode).toBe(403);

    const asAdmin = await app.inject({
      method: "GET",
      url: "/api/v1/admin/fleet/alerts",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(asAdmin.statusCode).toBe(200);
    const alert = asAdmin.json().items.find((i: { kind: string; ref: string }) => i.ref === unassignedTaskId);
    expect(alert).toMatchObject({ kind: "unassigned_task", severity: "high" });
  });

  it("POST /admin/fleet/tasks/{id}/reassign: refuses a driver (a driver could otherwise reassign any task)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/fleet/tasks/${assignedTaskId}/reassign`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: { driverId: driverBId, reason: "hijack attempt" }
    });
    expect(res.statusCode).toBe(403);

    const unchanged = await dbClient.query("select driver_id from delivery.delivery_tasks where id = $1", [assignedTaskId]);
    expect(unchanged.rows[0].driver_id).toBe(driverAId);
  });

  it("POST /admin/fleet/tasks/{id}/reassign: an admin reassigns the task, applied and audited under their real identity", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/fleet/tasks/${assignedTaskId}/reassign`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { driverId: driverBId, reason: "driver A called in sick" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("reassigned");

    const after = await dbClient.query("select driver_id, status from delivery.delivery_tasks where id = $1", [assignedTaskId]);
    expect(after.rows[0].driver_id).toBe(driverBId);
    expect(after.rows[0].status).toBe("assigned");

    const audit = await dbClient.query(
      "select actor_id, actor_role, reason, before, after from audit.audit_log where action = 'fleet.task.reassign' and resource_id = $1 order by at desc limit 1",
      [assignedTaskId]
    );
    expect(audit.rows[0].actor_id).toBe(adminId);
    expect(audit.rows[0].actor_role).toBe("admin");
    expect(audit.rows[0].reason).toBe("driver A called in sick");
    expect(audit.rows[0].before.driverId).toBe(driverAId);
    expect(audit.rows[0].after.driverId).toBe(driverBId);
  });

  it("POST /admin/fleet/tasks/{id}/reassign: a non-existent task is NOT_FOUND", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/fleet/tasks/00000000-0000-0000-0000-000000000099/reassign",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { driverId: driverBId, reason: "test" }
    });
    expect(res.statusCode).toBe(404);
  });
});
