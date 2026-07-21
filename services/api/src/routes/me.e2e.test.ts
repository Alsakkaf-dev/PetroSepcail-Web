import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// PC-GW-3's actual point: prove RLS is enforced through the real API path
// (JWT -> gateway actor resolution -> app_user + `set local
// request.jwt.claims` -> RLS policy), not just directly in SQL — S01's
// scripts/test-rls.mjs already proved the SQL side. Same docker-orchestration
// pattern as auth.e2e.test.ts (kept self-contained rather than sharing a test
// helper yet — worth extracting once a third E2E suite needs it, S04+).
const CONTAINER = "ps-me-e2e-test";
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

function dockerAvailable(): boolean {
  return spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
}

function stopContainer() {
  spawnSync("docker", ["stop", CONTAINER], { stdio: "ignore" });
}

async function waitForPostgres(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const client = new Client({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "test" });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres did not become ready within ${timeoutMs}ms`);
}

describe.runIf(dockerAvailable())("GET /api/v1/me — RLS enforced through the API path (PC-GW-3)", () => {
  let dir: string;
  let dbUrl: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let customerToken: string;
  let supplierToken: string;

  beforeAll(async () => {
    spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    execFileSync("docker", [
      "run", "--rm", "-d", "--name", CONTAINER,
      "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=test",
      "-p", "0:5432", "postgres:16-alpine"
    ]);
    const port = Number(execFileSync("docker", ["port", CONTAINER, "5432"]).toString().trim().split(":").pop());
    await waitForPostgres(port);
    dbUrl = `postgres://postgres:test@127.0.0.1:${port}/test`;

    execFileSync("npx", ["node-pg-migrate", "-m", "db/migrations", "--migration-file-language", "sql", "up"], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, DATABASE_URL: dbUrl }
    });

    dir = mkdtempSync(path.join(tmpdir(), "ps-me-e2e-"));
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

    const supplierLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "supplier.seed@petrospecial.internal", password: DEV_PASSWORD }
    });
    supplierToken = supplierLogin.json().accessToken;
  }, 60_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    rmSync(dir, { recursive: true, force: true });
    stopContainer();
  });

  it("returns the caller's own identity, not a static/cached value", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${customerToken}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(body.email).toBe("customer.seed@petrospecial.internal");
    expect(body.roles).toEqual(["customer"]);
  });

  it("a different caller gets a different, correctly-scoped identity through the same route", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${supplierToken}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe("00000000-0000-0000-0000-000000000002");
    expect(body.email).toBe("supplier.seed@petrospecial.internal");
    expect(body.roles).toEqual(["supplier"]);
  });

  it("rejects a request with no Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a garbage bearer token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: "Bearer not-a-real-token" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("RLS restricts an unfiltered query to exactly one row, even with no WHERE clause (the real proof)", async () => {
    const { withRlsTransaction } = await import("../db.js");
    const { verifyAccessToken } = await import("../security/jwt.js");
    const actor = await verifyAccessToken(customerToken);

    const count = await withRlsTransaction(actor, async (client) => {
      // Deliberately no WHERE clause — if this returns more than 1, RLS
      // isn't actually doing the filtering and something is badly wrong.
      const res = await client.query<{ n: number }>("select count(*)::int as n from core.identities");
      return res.rows[0]!.n;
    });
    expect(count).toBe(1);
  });

  // EP-PC-030 (PC-07, S05) — same server/DB as the /me tests above, no
  // reason to pay for a second docker spin-up in its own suite.
  it("GET /api/v1/i18n/ar returns the AR bundle for guests, no auth required", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/i18n/ar" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.locale).toBe("ar");
    expect(body.strings["nav.home"]).toBe("الرئيسية");
  });

  it("GET /api/v1/i18n/en returns the EN bundle", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/i18n/en" });
    expect(res.statusCode).toBe(200);
    expect(res.json().strings["nav.home"]).toBe("Home");
  });

  it("GET /api/v1/i18n/fr rejects an unsupported locale", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/i18n/fr" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
