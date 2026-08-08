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
    // Guarded: if beforeAll failed before `dir` was assigned, an unguarded
    // throw here would skip stop() below and permanently orphan the
    // postgres/smtp child process bound to this file's fixed port.
    if (dir) rmSync(dir, { recursive: true, force: true });
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

  it("rejects registering with an email or phone that already exists (IDENTITY_EXISTS, 409)", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Original",
        email: "duplicate.test@petrospecial.internal",
        phone: "+966501111196",
        password: "Freshly-Baked-99"
      }
    });
    expect(first.statusCode).toBe(201);

    const sameEmail = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Impersonator",
        email: "duplicate.test@petrospecial.internal",
        phone: "+966501111195",
        password: "Different-Pass-99"
      }
    });
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.json().error.code).toBe("IDENTITY_EXISTS");

    const samePhone = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Impersonator Two",
        email: "not-duplicate@petrospecial.internal",
        phone: "+966501111196",
        password: "Different-Pass-99"
      }
    });
    expect(samePhone.statusCode).toBe(409);
    expect(samePhone.json().error.code).toBe("IDENTITY_EXISTS");
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

  it("logout with an explicit refreshToken revokes only that family, not every session for the role", async () => {
    // auth.ts's own SPEC-GAP note: the frozen JWT carries no family_id, so
    // logout accepts an optional refreshToken to scope revocation to one
    // session. Two concurrent sessions (e.g. two browser tabs) — signing out
    // of one must leave the other alone.
    const sessionA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.driver, password: DEV_PASSWORD }
    });
    const sessionB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.driver, password: DEV_PASSWORD }
    });
    const { accessToken: accessA, refreshToken: refreshA } = sessionA.json();
    const { refreshToken: refreshB } = sessionB.json();

    const logoutA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${accessA}` },
      payload: { refreshToken: refreshA }
    });
    expect(logoutA.statusCode).toBe(204);

    const refreshAfterA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: refreshA }
    });
    expect(refreshAfterA.json().error.code).toBe("TOKEN_REUSE_DETECTED");

    // Session B's own refresh token was never touched.
    const refreshB2 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: refreshB }
    });
    expect(refreshB2.statusCode).toBe(200);
  });

  it("a refresh token past its own expiry is TOKEN_INVALID, not silently accepted", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.supplier, password: DEV_PASSWORD }
    });
    const { refreshToken } = login.json();
    const { sha256Hex } = await import("../security/tokens.js");

    await dbClient.query("update core.auth_tokens set expires_at = now() - interval '1 minute' where token_hash = $1", [
      sha256Hex(refreshToken)
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken }
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("TOKEN_INVALID");
  });

  it("an account lock clears once locked_until has passed", async () => {
    // The lock's own trigger (5 failed attempts) is already proven above;
    // this only needs a genuinely locked row to test expiry against, and
    // getting there directly keeps this file under the anonymous rate
    // limit (services/api/src/gateway/rateLimit.ts: 60/min by IP, shared
    // across every unauthenticated call this whole suite makes).
    const email = "lockout-expiry@petrospecial.internal";
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { fullName: "Lockout Expiry", email, phone: "+966501111197", password: "Correct-Password-9" }
    });
    const identityId = (await dbClient.query("select id from core.identities where email = $1", [email])).rows[0].id;
    await dbClient.query(
      "update core.identities set status = 'active', failed_logins = 5, locked_until = now() + interval '15 minutes' where id = $1",
      [identityId]
    );

    const stillLocked = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "Correct-Password-9" } });
    expect(stillLocked.json().error.code).toBe("ACCOUNT_LOCKED");

    await dbClient.query("update core.identities set locked_until = now() - interval '1 minute', failed_logins = 0 where id = $1", [
      identityId
    ]);

    const afterExpiry = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "Correct-Password-9" }
    });
    expect(afterExpiry.statusCode).toBe(200);
  });

  it("completes the password-reset flow and revokes prior sessions", async () => {
    // Endpoint contract deliberately never returns the raw reset token (no
    // enumeration) and PC-06's real mailer doesn't exist until S05 — so this
    // test seeds a token the same way the handler does (same hash function)
    // to exercise the real /password-reset/confirm logic end-to-end.
    const { sha256Hex, generateOpaqueToken } = await import("../security/tokens.js");
    const rawToken = generateOpaqueToken();

    // A session that exists before the reset — proves revokeAllAuthTokensForIdentity
    // (auth.ts's own call after a successful confirm) actually invalidates a
    // refresh token issued under the OLD password, not just that the new
    // password works. FR-PC01-007: "on reset, all sessions of that identity
    // are revoked."
    const preResetLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.customer, password: DEV_PASSWORD }
    });
    const { refreshToken: preResetRefreshToken } = preResetLogin.json();

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

    const preResetSessionAfterReset = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: preResetRefreshToken }
    });
    expect(preResetSessionAfterReset.json().error.code).toBe("TOKEN_REUSE_DETECTED");

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

  it("rejects mfa/enroll and mfa/confirm for a non-admin role", async () => {
    const customerLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.customer, password: DEV_PASSWORD }
    });
    const { accessToken } = customerLogin.json();

    const enroll = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/enroll",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(enroll.statusCode).toBe(403);
    expect(enroll.json().error.code).toBe("FORBIDDEN");

    const confirm = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { totp: "123456" }
    });
    expect(confirm.statusCode).toBe(403);
    expect(confirm.json().error.code).toBe("FORBIDDEN");
  });

  it("requires the current TOTP to re-enroll once MFA is already confirmed (prevents a stolen access token silently stripping MFA)", async () => {
    // The admin identity already has a confirmed secret from the earlier
    // enrollment test in this file (tests share the one ephemeral DB and
    // run in order) — re-derive it from the DB the same way the app itself
    // does, rather than threading state across `it` blocks.
    const { decryptTotpSecret } = await import("../security/mfaCrypto.js");
    const { currentTotp } = await import("../security/totp.js");
    const existing = await dbClient.query("select totp_secret, confirmed_at from core.mfa_secrets where identity_id = $1", [
      SEED_IDS.admin
    ]);
    expect(existing.rows[0]?.confirmed_at).toBeTruthy();
    const currentSecret = decryptTotpSecret(existing.rows[0].totp_secret);

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.admin, password: DEV_PASSWORD, totp: currentTotp(currentSecret) }
    });
    const { accessToken } = adminLogin.json();

    const withoutCode = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/enroll",
      headers: { authorization: `Bearer ${accessToken}` }
    });
    expect(withoutCode.json().error.code).toBe("MFA_REQUIRED");

    const wrongCode = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/enroll",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { totp: "000000" }
    });
    expect(wrongCode.json().error.code).toBe("MFA_INVALID");

    // Neither rejected attempt touched the stored secret.
    const stillConfirmed = await dbClient.query("select confirmed_at from core.mfa_secrets where identity_id = $1", [
      SEED_IDS.admin
    ]);
    expect(stillConfirmed.rows[0].confirmed_at).toEqual(existing.rows[0].confirmed_at);

    const withCorrectCode = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/enroll",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { totp: currentTotp(currentSecret) }
    });
    expect(withCorrectCode.statusCode).toBe(200);
    expect(typeof withCorrectCode.json().otpauthUri).toBe("string");

    // The reset is real: the old code no longer confirms a login, and the
    // account is left mid-re-enrollment (unconfirmed) until the new secret
    // is confirmed — proving this isn't a no-op re-issue of the same secret.
    const reset = await dbClient.query("select confirmed_at from core.mfa_secrets where identity_id = $1", [SEED_IDS.admin]);
    expect(reset.rows[0].confirmed_at).toBeNull();
  });

  it("enforces the 12h admin absolute session cap, but not on other roles (04-roles §1)", async () => {
    const superAdminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.super_admin, password: DEV_PASSWORD }
    });
    const { refreshToken: superAdminRefresh } = superAdminLogin.json();

    const family = await dbClient.query(
      "select family_id from core.auth_tokens where identity_id = $1 and revoked_at is null order by issued_at desc limit 1",
      [SEED_IDS.super_admin]
    );
    const familyId = family.rows[0].family_id;
    // Backdate the family's origin past the 12h cap — rotation never touches
    // an earlier row's issued_at, so this is what a genuinely 13h-old
    // session's origin row would look like.
    await dbClient.query("update core.auth_tokens set issued_at = now() - interval '13 hours' where family_id = $1", [
      familyId
    ]);

    const capped = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: superAdminRefresh }
    });
    expect(capped.statusCode).toBe(401);
    expect(capped.json().error.code).toBe("TOKEN_REUSE_DETECTED");

    const revoked = await dbClient.query("select revoked_at from core.auth_tokens where family_id = $1", [familyId]);
    expect(revoked.rows.every((r) => r.revoked_at !== null)).toBe(true);

    // The same 13h-old origin on a non-admin role's family must NOT be
    // capped — the spec sets this limit for admin/super_admin only.
    const customerLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: SEED_EMAILS.customer, password: DEV_PASSWORD }
    });
    const { refreshToken: customerRefresh } = customerLogin.json();
    const customerFamily = await dbClient.query(
      "select family_id from core.auth_tokens where identity_id = $1 and revoked_at is null order by issued_at desc limit 1",
      [SEED_IDS.customer]
    );
    await dbClient.query("update core.auth_tokens set issued_at = now() - interval '13 hours' where family_id = $1", [
      customerFamily.rows[0].family_id
    ]);
    const stillWorks = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: customerRefresh }
    });
    expect(stillWorks.statusCode).toBe(200);
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
