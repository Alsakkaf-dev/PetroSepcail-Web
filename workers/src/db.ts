import { Pool, type PoolClient } from "pg";
import { logger } from "./logger.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });
    pool.on("error", (err) => {
      logger.error({ err }, "workers/db: idle client error");
    });
  }
  return pool;
}

// Background/alerting work runs over app_service_role (BYPASSRLS) — same
// no-end-user-policy pattern as realtime's dispatcher (services/realtime/src/db.ts).
export async function withServiceRoleTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role app_service_role");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
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
