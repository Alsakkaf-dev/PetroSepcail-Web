import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// AC-03/AC-10 (S17/S18): the >SAR 100,000 credit-limit dual-control gate and
// the admin PII-read audit trail both depend on core.admin_set_credit_limit
// and core.admin_read_customer reading app_auth.jwt() for the calling
// admin's identity. Both functions are invoked through withServiceRoleTransaction,
// which never set request.jwt.claims before this fix - Postgres treats a
// NULL IF-condition as false, so `if role <> 'super_admin' then raise` never
// fired, and every audit-log/dual-control row recorded a NULL actor. This
// suite drives the real HTTP routes end to end (not a hand-rolled DB call)
// so it fails exactly the way production would have.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("Admin credit-limit dual control and PII-read audit (AC-03/AC-10)", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let adminToken: string;
  let superAdminToken: string;
  let adminId: string;
  let superAdminId: string;
  let customerId: string;
  let supplierRowId: string;
  let dbClient: Client;

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54353);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-admin-credit-e2e-"));
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

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin.seed@petrospecial.internal", password: DEV_PASSWORD }
    });
    adminToken = adminLogin.json().accessToken;
    const superAdminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "superadmin.seed@petrospecial.internal", password: DEV_PASSWORD }
    });
    superAdminToken = superAdminLogin.json().accessToken;

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();

    adminId = (await dbClient.query("select id from core.identities where email = 'admin.seed@petrospecial.internal'")).rows[0].id;
    superAdminId = (
      await dbClient.query("select id from core.identities where email = 'superadmin.seed@petrospecial.internal'")
    ).rows[0].id;
    customerId = (
      await dbClient.query("select id from core.identities where email = 'customer.seed@petrospecial.internal'")
    ).rows[0].id;
    supplierRowId = (await dbClient.query("select id from credit.suppliers limit 1")).rows[0].id;
  }, 90_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    await dbClient?.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
    await pg?.stop();
  });

  it("FR-AC03-002: a regular admin is refused a credit limit above SAR 100,000 (dual control never bypassed)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/suppliers/${supplierRowId}/credit-limit`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { newLimit: 150000, reason: "attempted escalation" }
    });
    expect(res.statusCode).toBe(403);

    // Never reached the point of creating a pending approval under the
    // wrong actor - confirms the role check actually fired, not just that
    // the request happened to fail some other way.
    const pending = await dbClient.query(
      "select count(*)::int as n from audit.dual_control_approvals where request_kind = 'credit_limit_over_threshold' and (payload->>'new_limit')::numeric = 150000"
    );
    expect(pending.rows[0].n).toBe(0);
  });

  it("FR-AC03-001/002: a super_admin's over-threshold request is recorded as pending under their own real identity, not NULL", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/suppliers/${supplierRowId}/credit-limit`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { newLimit: 200000, reason: "large distributor expansion" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending_dual_control");

    const approval = await dbClient.query(
      "select requested_by, status from audit.dual_control_approvals where request_kind = 'credit_limit_over_threshold' and (payload->>'new_limit')::numeric = 200000"
    );
    expect(approval.rows[0].requested_by).toBe(superAdminId);
    expect(approval.rows[0].status).toBe("pending");
  });

  it("GET /admin/dual-control lists the pending approval; a different super_admin can acknowledge and resubmitting applies it", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/dual-control", headers: { authorization: `Bearer ${adminToken}` } });
    expect(list.statusCode).toBe(200);
    const item = list.json().items.find((i: { supplierId: string; newLimit: string }) => i.supplierId === supplierRowId && Number(i.newLimit) === 200000);
    expect(item).toBeTruthy();

    const selfAck = await app.inject({
      method: "POST",
      url: `/api/v1/admin/dual-control/${item.approvalId}/acknowledge`,
      headers: { authorization: `Bearer ${superAdminToken}` }
    });
    expect(selfAck.statusCode).toBe(403);

    // A second, genuinely different super_admin - real-world this is
    // provisioned by an existing super_admin granting the role; seeded
    // directly here with the same known dev password for login convenience,
    // the same precedent other e2e suites already use for setup data.
    const passwordHash = (await dbClient.query("select password_hash from core.identities where id = $1", [superAdminId])).rows[0].password_hash;
    const secondSuperAdminId = (
      await dbClient.query(
        `insert into core.identities (full_name, email, phone, password_hash, status, locale)
         values ('Second Super Admin', 'second-superadmin@petrospecial.internal', '+966599999999', $1, 'active', 'en')
         returning id`,
        [passwordHash]
      )
    ).rows[0].id;
    await dbClient.query("insert into core.role_grants (identity_id, role) values ($1, 'super_admin')", [secondSuperAdminId]);
    const secondSuperAdminToken = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "second-superadmin@petrospecial.internal", password: DEV_PASSWORD }
      })
    ).json().accessToken;

    const ack = await app.inject({
      method: "POST",
      url: `/api/v1/admin/dual-control/${item.approvalId}/acknowledge`,
      headers: { authorization: `Bearer ${secondSuperAdminToken}` }
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().status).toBe("approved");

    // Acknowledging alone doesn't move money - the limit is still whatever
    // it was before this whole approval started (credit.admin_set_credit_limit's
    // own idempotent-approval check only applies it on a matching resubmit).
    const stillOld = await dbClient.query("select limit_amount from credit.credit_limits where supplier_id = $1 and is_current", [supplierRowId]);
    expect(Number(stillOld.rows[0].limit_amount)).not.toBe(200000);

    const reapply = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/suppliers/${supplierRowId}/credit-limit`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { newLimit: 200000, reason: "large distributor expansion" }
    });
    expect(reapply.statusCode).toBe(200);
    expect(reapply.json().status).toBe("applied");

    const applied = await dbClient.query("select limit_amount from credit.credit_limits where supplier_id = $1 and is_current", [supplierRowId]);
    expect(Number(applied.rows[0].limit_amount)).toBe(200000);

    const listAfter = await app.inject({ method: "GET", url: "/api/v1/admin/dual-control", headers: { authorization: `Bearer ${adminToken}` } });
    expect(listAfter.json().items.some((i: { approvalId: string }) => i.approvalId === item.approvalId)).toBe(false);
  });

  it("FR-AC03-001: an under-threshold change applies directly and is audited under the real admin's identity", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/suppliers/${supplierRowId}/credit-limit`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { newLimit: 30000, reason: "routine review" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("applied");

    const limitRow = await dbClient.query(
      "select set_by from credit.credit_limits where supplier_id = $1 and is_current",
      [supplierRowId]
    );
    expect(limitRow.rows[0].set_by).toBe(adminId);

    const audit = await dbClient.query(
      "select actor_id, actor_role from audit.audit_log where action = 'credit.limit.change' and resource_id = $1 order by at desc limit 1",
      [supplierRowId]
    );
    expect(audit.rows[0].actor_id).toBe(adminId);
    expect(audit.rows[0].actor_role).toBe("admin");
  });

  it("FR-AC10-001/PC-03: a PII read is recorded against the reading admin's real identity, not NULL (EP-AC-090)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/customers/read",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { customerId, reason: "support ticket #4821" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(customerId);
    expect(body).not.toHaveProperty("passwordHash");
    expect(body).not.toHaveProperty("password_hash");

    const audit = await dbClient.query(
      "select actor_id, actor_role, reason from audit.audit_log where action = 'pii_read' and resource_id = $1 order by at desc limit 1",
      [customerId]
    );
    expect(audit.rows[0].actor_id).toBe(adminId);
    expect(audit.rows[0].actor_role).toBe("admin");
    expect(audit.rows[0].reason).toBe("support ticket #4821");
  });

  it("FR-AC10-001: a PII read with no reason is refused before touching the audit log", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/customers/read",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { customerId, reason: "" }
    });
    expect(res.statusCode).toBe(422);
  });
});
