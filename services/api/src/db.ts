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
    // Bounded, matching the 2s budget the /ready storage/realtime probes
    // already use (gateway/readiness.ts) — without this, pg's default of no
    // timeout lets a single unreachable/slow DB host hang the whole pool
    // (and, via pingDb(), the readiness check) indefinitely.
    pool = new Pool({ connectionString: requireEnv("DATABASE_URL"), connectionTimeoutMillis: 2000 });
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
// tables that are either app_service_role-only by design (core.auth_tokens,
// core.mfa_secrets, core.verification_tokens — see db/migrations/0006,
// S01) or need to bypass the self-row RLS check at creation time
// (core.identities INSERT at registration has no JWT yet). `SET LOCAL ROLE`
// (transaction-scoped, not session-scoped `SET ROLE`) avoids ever leaking an
// elevated role onto a pooled connection that a later, unrelated request
// might reuse — it resets automatically at COMMIT/ROLLBACK.
// `actor` is optional and, when passed, is set as `request.jwt.claims` the
// same way withRlsTransaction already does — several SECURITY DEFINER
// functions read app_auth.jwt() for the calling admin's identity (audit-log
// actor_id/actor_role, role-gated checks like credit.admin_set_credit_limit's
// >SAR 100,000 dual-control test). Without it, app_auth.jwt() is null under
// this role, which silently no-ops any `if role not in (...) then raise`
// check (Postgres treats a NULL IF-condition as false, not true) and writes
// a NULL actor_id to the audit log — found live via test-rls.mjs coverage
// gaps, not a hypothetical. Callers that already pass an explicit actor id
// as a SQL parameter (the admin_force_cancel-style functions) don't need
// this; it's additive for the ones that don't.
export async function withServiceRoleTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  actor?: AccessTokenClaims | null
): Promise<T> {
  return runInTransaction(async (client) => {
    await client.query("set local role app_service_role");
    if (actor) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(actor)]);
    }
  }, fn);
}

// PC-GW-3 (S03): the general per-request path for every *other* (non-auth)
// business endpoint. `app_user` is RLS-bound (db/migrations/0003, S01); the
// actor's JWT claims are handed to Postgres via `set_config('request.jwt.claims',
// ..., true)` — the `true` (is_local) makes it equivalent to `SET LOCAL`, so
// it resets at COMMIT/ROLLBACK and never leaks onto a pooled connection a
// later, unrelated request might reuse. RLS policies read it back through
// app_auth.jwt() (db/migrations/0001, S01) — this is the literal mechanism
// 03-sdd.md §10 names: "JWT claims passed to Postgres via `set local
// request.jwt.claims`".
// `actor` may be null for public/guest-reachable endpoints (e.g. EP-PC-030
// GET /i18n/{locale}) that still want the RLS-bound path rather than
// app_service_role — core.i18n_strings' `i18n_public_read` policy is `using
// (true)` regardless of claims, so app_user with no claims set still reads
// it fine; app_auth.jwt() simply returns null, and any claim-based predicate
// correctly evaluates to false/no-match for a guest.
export async function withRlsTransaction<T>(
  actor: AccessTokenClaims | null,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return runInTransaction(async (client) => {
    await client.query("set local role app_user");
    if (actor) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(actor)]);
    }
  }, fn);
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

// EP-PC-061 /ready (FR-PC04-005): a real DB round-trip, not just "pool exists".
export async function pingDb(): Promise<boolean> {
  try {
    await getPool().query("select 1");
    return true;
  } catch {
    return false;
  }
}
