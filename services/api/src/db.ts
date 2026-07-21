import { Pool, type PoolClient } from "pg";
import { ApiError } from "./errors.js";
import type { AccessTokenClaims } from "./security/jwt.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });
    // node-postgres: "the pool will emit an error on behalf of any idle
    // clients it contains if they encounter network-related errors ...
    // your application should always register an 'error' handler on the
    // pool" — without one, a dropped idle connection throws an unhandled
    // 'error' event and crashes the process.
    pool.on("error", (err) => {
      console.error("[db] idle client error", err);
    });
  }
  return pool;
}

// Shared commit/rollback discipline for both transaction helpers below.
// A thrown ApiError is a controlled business-logic outcome (wrong password,
// invalid/reused token, RLS-invisible row, ...), not a DB failure — side
// effects recorded before it (failed-login counters, refresh-family
// revocation on reuse, etc.) are intentional and must still be committed,
// not undone. Only genuinely unexpected errors roll back.
async function runInTransaction<T>(setup: (client: PoolClient) => Promise<void>, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await setup(client);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    if (err instanceof ApiError) {
      await client.query("commit").catch(() => {});
      throw err;
    }
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// PC-01/02 auth module: registration/login/refresh/MFA/reset all write
// tables that are either service_role-only by design (core.auth_tokens,
// core.mfa_secrets, core.verification_tokens — see db/migrations/0006,
// S01) or need to bypass the self-row RLS check at creation time
// (core.identities INSERT at registration has no JWT yet). `SET LOCAL ROLE`
// (transaction-scoped, not session-scoped `SET ROLE`) avoids ever leaking an
// elevated role onto a pooled connection that a later, unrelated request
// might reuse — it resets automatically at COMMIT/ROLLBACK.
export async function withServiceRoleTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return runInTransaction((client) => client.query("set local role service_role").then(() => {}), fn);
}

// PC-GW-3 (S03): the general per-request path for every *other* (non-auth)
// business endpoint. `app_user` is RLS-bound (db/migrations/0003, S01); the
// actor's JWT claims are handed to Postgres via `set_config('request.jwt.claims',
// ..., true)` — the `true` (is_local) makes it equivalent to `SET LOCAL`, so
// it resets at COMMIT/ROLLBACK and never leaks onto a pooled connection a
// later, unrelated request might reuse. RLS policies read it back through
// auth.jwt() (db/migrations/0001, S01) — this is the literal mechanism
// 03-sdd.md §10 names: "JWT claims passed to Postgres via `set local
// request.jwt.claims`".
export async function withRlsTransaction<T>(
  actor: AccessTokenClaims,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return runInTransaction(async (client) => {
    await client.query("set local role app_user");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(actor)]);
  }, fn);
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
