import { Pool, type PoolClient } from "pg";
import { ApiError } from "./errors.js";

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

// PC-01/02 auth module: registration/login/refresh/MFA/reset all write
// tables that are either service_role-only by design (core.auth_tokens,
// core.mfa_secrets, core.verification_tokens — see db/migrations/0006,
// S01) or need to bypass the self-row RLS check at creation time
// (core.identities INSERT at registration has no JWT yet). `SET LOCAL ROLE`
// (transaction-scoped, not session-scoped `SET ROLE`) avoids ever leaking an
// elevated role onto a pooled connection that a later, unrelated request
// might reuse — it resets automatically at COMMIT/ROLLBACK.
//
// S03 (PC-GW-3) wires the general per-request `app_user` + `request.jwt.claims`
// path used by every other (non-auth) business endpoint.
export async function withServiceRoleTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    if (err instanceof ApiError) {
      // A controlled business-logic outcome (wrong password, invalid/reused
      // token, ...) is not a DB failure — side effects recorded before it
      // (failed-login counters, refresh-family revocation on reuse, etc.)
      // are intentional and must still be committed, not undone.
      await client.query("commit").catch(() => {});
      throw err;
    }
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
