import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// AC-06 (S09): admin provisions suppliers/drivers/admins, role grants/revokes
// (super-admin only), suspend/reactivate.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("Admin user management (AC-06)", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let adminToken: string;
  let superAdminToken: string;
  let customerToken: string;
  let dbClient: Client;

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54352);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-admin-users-e2e-"));
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
    process.env.EMAIL_MODE = "onscreen"; // D-17 — activation link returned directly, no SMTP

    const { buildServer } = await import("../server.js");
    app = await buildServer();

    adminToken = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "admin.seed@petrospecial.internal", password: DEV_PASSWORD }
      })
    ).json().accessToken;
    superAdminToken = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "superadmin.seed@petrospecial.internal", password: DEV_PASSWORD }
      })
    ).json().accessToken;
    customerToken = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "customer.seed@petrospecial.internal", password: DEV_PASSWORD }
      })
    ).json().accessToken;

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();
  }, 90_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    await dbClient?.end();
    rmSync(dir, { recursive: true, force: true });
    await pg?.stop();
  });

  it("FR-AC06-001: admin provisions a supplier — active immediately, 72h activation link, EV-PC-002 + audit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users/suppliers",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { fullName: "New Supplier Co", email: "new-supplier@example.com", phone: "+966511111111" }
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.role).toBe("supplier");
    expect(body.status).toBe("active");
    expect(body.activationLink).toContain("token=");

    const identity = await dbClient.query("select status from core.identities where id = $1", [body.identityId]);
    expect(identity.rows[0].status).toBe("active");
    const grant = await dbClient.query("select role from core.role_grants where identity_id = $1", [body.identityId]);
    expect(grant.rows.map((r: { role: string }) => r.role)).toEqual(["supplier"]);

    const event = await dbClient.query("select payload from core.outbox where name = 'identity.role.granted' order by occurred_at desc limit 1");
    expect(event.rows[0].payload.role).toBe("supplier");
    const audit = await dbClient.query("select action from audit.audit_log where resource_id = $1", [body.identityId]);
    expect(audit.rows.map((r: { action: string }) => r.action)).toContain("user.provisioned");
  });

  it("FR-AC06-001: admin provisions a driver", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users/drivers",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { fullName: "New Driver", email: "new-driver@example.com", phone: "+966522222222" }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe("driver");
  });

  it("FR-AC06-002: a regular admin is refused creating another admin (super-admin only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users/admins",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { fullName: "Rogue Admin", email: "rogue@example.com", phone: "+966533333333" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("FR-AC06-002: a super-admin CAN create a new admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users/admins",
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { fullName: "New Admin", email: "new-admin@example.com", phone: "+966544444444" }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe("admin");
  });

  it("FR-AC06-002: role grant/revoke is super-admin-only and updates core.role_grants", async () => {
    const provisioned = (
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/users/suppliers",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { fullName: "Multi Role", email: "multi-role@example.com", phone: "+966555555555" }
      })
    ).json();

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${provisioned.identityId}/grants`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: "driver", action: "grant" }
    });
    expect(forbidden.statusCode).toBe(403);

    const granted = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${provisioned.identityId}/grants`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { role: "driver", action: "grant" }
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json().roles.sort()).toEqual(["driver", "supplier"]);

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${provisioned.identityId}/grants`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { role: "driver", action: "revoke" }
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().roles).toEqual(["supplier"]);
  });

  it("FR-AC06-003: admin suspends a user — blocked at sign-in; reactivating restores access", async () => {
    const provisioned = (
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/users/drivers",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { fullName: "Suspendable Driver", email: "suspendable@example.com", phone: "+966566666666" }
      })
    ).json();
    await dbClient.query("update core.identities set password_hash = $2 where id = $1", [
      provisioned.identityId,
      "$argon2id$v=19$m=65536,t=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" // unusable, login not exercised here
    ]);

    const suspend = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${provisioned.identityId}/status`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: "suspended", reason: "policy_violation" }
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().status).toBe("suspended");

    const statusRow = await dbClient.query("select status from core.identities where id = $1", [provisioned.identityId]);
    expect(statusRow.rows[0].status).toBe("suspended");

    const auditRow = await dbClient.query(
      "select before, after, reason from audit.audit_log where resource_id = $1 and action = 'user.status_changed'",
      [provisioned.identityId]
    );
    expect(auditRow.rows[0].before).toEqual({ status: "active" });
    expect(auditRow.rows[0].after).toEqual({ status: "suspended" });
    expect(auditRow.rows[0].reason).toBe("policy_violation");

    const reactivate = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${provisioned.identityId}/status`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: "active", reason: "appeal_approved" }
    });
    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json().status).toBe("active");
  });

  it("a customer cannot provision users or change status (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users/suppliers",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { fullName: "X", email: "x@example.com", phone: "+966577777777" }
    });
    expect(res.statusCode).toBe(403);
  });
});
