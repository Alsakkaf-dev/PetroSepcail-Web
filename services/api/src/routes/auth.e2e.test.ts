import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";
import { startEphemeralSmtp, type EphemeralSmtp } from "../testHelpers/ephemeralSmtp.js";

// Real end-to-end verification of S02 (PC-01/02): spins up an ephemeral
// Postgres, applies the actual db/migrations, then drives the actual HTTP
// routes via Fastify's inject() — proving the S02 Out contract ("all 5
// seeded roles can log in end-to-end; token lifecycle complete") for real,
// not by unit-testing pieces in isolation.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("condition not met within timeout");
}

describe("PC-01/02 auth E2E (real Postgres)", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  let smtp: EphemeralSmtp;
  let dbClient: Client; // raw superuser connection for direct test setup (no HTTP shortcut exists)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54341);
    const dbUrl = pg.dbUrl;

    // FR-PC06-004: real SMTP delivery test target (catcher mode's actual
    // T1 backend), proving deliverEmail() genuinely sends mail rather than
    // just asserting the onscreen fallback works.
    smtp = await startEphemeralSmtp(54342);

    dir = mkdtempSync(path.join(tmpdir(), "ps-auth-e2e-"));
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
    process.env.EMAIL_MODE = "onscreen"; // so register returns a verifyLink for real E2E
    process.env.PUBLIC_BASE_URL = "https://localhost";
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(smtp.port);
    process.env.SMTP_FROM = "no-reply@petrospecial.internal";

    const { buildServer } = await import("../server.js");
    app = await buildServer();

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();
  }, 60_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    const { closeEmailTransport } = await import("../notifications/emailAdapter.js");
    closeEmailTransport();
    await dbClient?.end();
    await app?.close();
    await closePool(); // must close before the container stops, or idle
    // clients emit an unhandled 'error' event when Postgres force-closes them
    rmSync(dir, { recursive: true, force: true });
    await smtp?.stop();
    await pg?.stop();
  });

  const SEED_IDS: Record<string, string> = {
    customer: "00000000-0000-0000-0000-000000000001",
    supplier: "00000000-0000-0000-0000-000000000002",
    driver: "00000000-0000-0000-0000-000000000003",
    admin: "00000000-0000-0000-0000-000000000004",
    super_admin: "00000000-0000-0000-0000-000000000005"
  };
  const SEED_EMAILS: Record<string, string> = {
    customer: "customer.seed@petrospecial.internal",
    supplier: "supplier.seed@petrospecial.internal",
    driver: "driver.seed@petrospecial.internal",
    admin: "admin.seed@petrospecial.internal",
    super_admin: "superadmin.seed@petrospecial.internal"
  };

  it.each(Object.keys(SEED_IDS))("seeded %s can log in end-to-end", async (role) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS[role], password: DEV_PASSWORD }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe(role);
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
    expect(body.expiresIn).toBe(3600);
  });

  it("rejects a wrong password with INVALID_CREDENTIALS", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.customer, password: "totally-wrong" }
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("locks the account after 5 failed attempts (FR-PC01-003 AC4)", async () => {
    await dbClient.query("insert into core.identities (id, full_name, email, phone, password_hash) values ($1,$2,$3,$4,$5)", [
      "20000000-0000-0000-0000-000000000001",
      "Lockout Test",
      "lockout.test@petrospecial.internal",
      "+966501000001",
      "$argon2id$SEED-PLACEHOLDER$not-real"
    ]);
    await dbClient.query("update core.identities set status = 'active' where id = $1", ["20000000-0000-0000-0000-000000000001"]);
    await dbClient.query("insert into core.role_grants (identity_id, role) values ($1,'customer')", [
      "20000000-0000-0000-0000-000000000001"
    ]);

    let last;
    for (let i = 0; i < 5; i++) {
      last = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "lockout.test@petrospecial.internal", password: "wrong-password" }
      });
    }
    expect(last!.json().error.code).toBe("ACCOUNT_LOCKED");
    expect(last!.statusCode).toBe(423);
  });

  it("registers, verifies via the onscreen link, then logs in", async () => {
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "New Customer",
        email: "new.customer@petrospecial.internal",
        phone: "+966501111111",
        password: "Freshly-Baked-99"
      }
    });
    expect(registerRes.statusCode).toBe(201);
    const { verifyLink, status } = registerRes.json();
    expect(status).toBe("pending_verification");
    expect(typeof verifyLink).toBe("string");
    const token = new URL(verifyLink).searchParams.get("token")!;

    const preVerifyLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "new.customer@petrospecial.internal", password: "Freshly-Baked-99" }
    });
    expect(preVerifyLogin.json().error.code).toBe("EMAIL_UNVERIFIED");

    const verifyRes = await app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token } });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().status).toBe("active");

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "new.customer@petrospecial.internal", password: "Freshly-Baked-99" }
    });
    expect(loginRes.statusCode).toBe(200);
  });

  it("rejects reusing an already-verified token", async () => {
    // Re-verify with a fresh registration's token twice.
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Reuse Test",
        email: "reuse.test@petrospecial.internal",
        phone: "+966501111112",
        password: "Freshly-Baked-99"
      }
    });
    const token = new URL(registerRes.json().verifyLink).searchParams.get("token")!;
    const first = await app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token } });
    expect(second.json().error.code).toBe("TOKEN_INVALID");
  });

  it("rotates refresh tokens and detects reuse of an already-rotated token", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.driver, password: DEV_PASSWORD }
    });
    const { refreshToken: firstRefresh } = login.json();

    const refreshed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: firstRefresh }
    });
    expect(refreshed.statusCode).toBe(200);
    const { refreshToken: secondRefresh, accessToken: secondAccess } = refreshed.json();
    expect(secondRefresh).not.toBe(firstRefresh);

    // Reusing the already-rotated first refresh token must be detected and
    // revoke the WHOLE family — including the second (legitimately rotated) one.
    const reuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: firstRefresh }
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe("TOKEN_REUSE_DETECTED");

    const secondNowRevoked = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: secondRefresh }
    });
    expect(secondNowRevoked.json().error.code).toBe("TOKEN_REUSE_DETECTED");
    void secondAccess;
  });

  it("logout revokes the session so its refresh token stops working", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.supplier, password: DEV_PASSWORD }
    });
    const { accessToken, refreshToken } = login.json();

    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(logoutRes.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken }
    });
    expect(afterLogout.json().error.code).toBe("TOKEN_REUSE_DETECTED");
  });

  it("completes the password-reset flow and revokes prior sessions", async () => {
    // Endpoint contract deliberately never returns the raw reset token (no
    // enumeration) and PC-06's real mailer doesn't exist until S05 — so this
    // test seeds a token the same way the handler does (same hash function)
    // to exercise the real /password-reset/confirm logic end-to-end.
    const { sha256Hex, generateOpaqueToken } = await import("../security/tokens.js");
    const rawToken = generateOpaqueToken();

    const requestRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password-reset/request",
      payload: { email: SEED_EMAILS.customer }
    });
    expect(requestRes.statusCode).toBe(202);

    await dbClient.query(
      `insert into core.verification_tokens (identity_id, purpose, token_hash, expires_at)
       values ($1, 'password_reset', $2, now() + interval '30 minutes')`,
      [SEED_IDS.customer, sha256Hex(rawToken)]
    );

    const confirmRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password-reset/confirm",
      payload: { token: rawToken, newPassword: "Brand-New-Password-1" }
    });
    expect(confirmRes.statusCode).toBe(200);

    const oldPasswordLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.customer, password: DEV_PASSWORD }
    });
    expect(oldPasswordLogin.json().error.code).toBe("INVALID_CREDENTIALS");

    const newPasswordLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.customer, password: "Brand-New-Password-1" }
    });
    expect(newPasswordLogin.statusCode).toBe(200);

    // Restore the shared dev password so later tests in this file are unaffected.
    const { hashPassword } = await import("../security/password.js");
    await dbClient.query("update core.identities set password_hash = $2 where id = $1", [
      SEED_IDS.customer,
      await hashPassword(DEV_PASSWORD)
    ]);
  });

  it("enrolls MFA for an admin, then requires and validates it on login", async () => {
    const bootstrapLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.admin, password: DEV_PASSWORD }
    });
    expect(bootstrapLogin.statusCode).toBe(200); // no MFA enrolled yet — bootstrap allowed
    const { accessToken } = bootstrapLogin.json();

    const enrollRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/enroll",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(enrollRes.statusCode).toBe(200);
    const { otpauthUri } = enrollRes.json();
    const secret = new URL(otpauthUri).searchParams.get("secret")!;

    const { currentTotp } = await import("../security/totp.js");

    const wrongConfirm = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { totp: "000000" }
    });
    expect(wrongConfirm.json().error.code).toBe("MFA_INVALID");

    const confirmRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { totp: currentTotp(secret) }
    });
    expect(confirmRes.statusCode).toBe(200);
    expect(confirmRes.json().enabled).toBe(true);

    const loginNoTotp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.admin, password: DEV_PASSWORD }
    });
    expect(loginNoTotp.json().error.code).toBe("MFA_REQUIRED");

    const loginBadTotp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.admin, password: DEV_PASSWORD, totp: "111111" }
    });
    expect(loginBadTotp.json().error.code).toBe("MFA_INVALID");

    const loginGoodTotp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.admin, password: DEV_PASSWORD, totp: currentTotp(secret) }
    });
    expect(loginGoodTotp.statusCode).toBe(200);
    expect(loginGoodTotp.json().role).toBe("admin");
  });

  it("offers role selection for a multi-grant identity and honors the chosen role", async () => {
    await dbClient.query("insert into core.role_grants (identity_id, role) values ($1, 'admin')", [SEED_IDS.driver]);

    const noRole = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.driver, password: DEV_PASSWORD }
    });
    expect(noRole.statusCode).toBe(200);
    expect(noRole.json()).toMatchObject({ status: "role_selection_required" });
    expect(noRole.json().roles.sort()).toEqual(["admin", "driver"]);

    const asDriver = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.driver, password: DEV_PASSWORD, role: "driver" }
    });
    expect(asDriver.statusCode).toBe(200);
    expect(asDriver.json().role).toBe("driver");

    const wrongRole = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.driver, password: DEV_PASSWORD, role: "supplier" }
    });
    expect(wrongRole.json().error.code).toBe("FORBIDDEN");

    await dbClient.query("delete from core.role_grants where identity_id = $1 and role = 'admin'", [SEED_IDS.driver]);
  });

  it("requests account deletion and blocks subsequent logins", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "new.customer@petrospecial.internal", password: "Freshly-Baked-99" }
    });
    const { accessToken } = login.json();

    const deleteRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/account/delete",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(deleteRes.statusCode).toBe(202);
    expect(deleteRes.json().status).toBe("pending_deletion");
    expect(typeof deleteRes.json().purgeAfter).toBe("string");

    const loginAfterDelete = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "new.customer@petrospecial.internal", password: "Freshly-Baked-99" }
    });
    expect(loginAfterDelete.json().error.code).toBe("ACCOUNT_LOCKED");
  });

  it("delivers a real verification email via SMTP when EMAIL_MODE is not onscreen (FR-PC06-004)", async () => {
    const realEmailMode = process.env.EMAIL_MODE;
    process.env.EMAIL_MODE = "catcher";
    try {
      const registerRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          fullName: "Mailpit Test",
          email: "mailpit.test@petrospecial.internal",
          phone: "+966501111199",
          password: "Freshly-Baked-99",
          locale: "en" // explicit, to also prove locale selects the template (FR-PC06-002)
        }
      });
      expect(registerRes.statusCode).toBe(201);
      expect(registerRes.json().verifyLink).toBeUndefined(); // not onscreen — no link in the response

      await waitFor(async () =>
        smtp.messages.some((m) => m.to.includes("mailpit.test@petrospecial.internal"))
      );
      const mail = smtp.messages.find((m) => m.to.includes("mailpit.test@petrospecial.internal"))!;

      expect(mail.subject).toBe("Verify your PetroSpecial account");
      expect(mail.text).toContain("/verify-email?token=");

      // Delivery was logged (FR-PC06-005).
      const log = await dbClient.query(
        "select status from core.notification_log where channel = 'email' order by at desc limit 1"
      );
      expect(log.rows[0].status).toBe("sent");
    } finally {
      process.env.EMAIL_MODE = realEmailMode;
    }
  }, 15_000);
});
