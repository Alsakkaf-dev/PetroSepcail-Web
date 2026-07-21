import { Client, Pool, type PoolClient } from "pg";

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
      console.error("[realtime/db] idle client error", err);
    });
  }
  return pool;
}

// Dispatcher/consumer work: unlike the api gateway, a failed consumer here
// should genuinely roll back (the event stays undispatched and is retried
// on the next drain — see dispatcher.ts) rather than commit a partial
// outcome, so this is a plain rollback-on-any-error transaction, no
// ApiError-style special case needed.
export async function withServiceRoleTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
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

// A dedicated, non-pooled connection for LISTEN — required because LISTEN
// state is per-session and a pooled connection could be handed to unrelated
// queries between notifications.
export async function createListenerClient(): Promise<Client> {
  const client = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();
  return client;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
