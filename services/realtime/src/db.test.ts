import { beforeEach, describe, expect, it, vi } from "vitest";

// pg is fully mocked so the transaction semantics (begin -> set role -> fn ->
// commit, rollback-and-rethrow on error, release-in-finally, single reused
// pool) can be asserted with no real Postgres. The real DB path is also
// covered by the Docker e2e (roundTrip.e2e.test.ts).
const h = vi.hoisted(() => ({
  poolCtorCount: 0,
  connectCount: 0,
  endCount: 0,
  failOn: null as string | null,
  lastClient: null as { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } | null
}));

vi.mock("./logger.js", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

vi.mock("pg", () => {
  class Pool {
    end = vi.fn(async () => {
      h.endCount += 1;
    });
    on = vi.fn();
    connect = vi.fn(async () => {
      h.connectCount += 1;
      const client = {
        query: vi.fn(async (sql: string) => {
          if (h.failOn && sql.includes(h.failOn)) throw new Error(`query failed: ${sql}`);
          return { rows: [], rowCount: 0 };
        }),
        release: vi.fn()
      };
      h.lastClient = client;
      return client;
    });
    constructor(_config: unknown) {
      h.poolCtorCount += 1;
    }
  }
  class Client {
    connect = vi.fn(async () => {});
    query = vi.fn(async () => ({}));
    end = vi.fn(async () => {});
    on = vi.fn();
    constructor(_config: unknown) {}
  }
  return { Pool, Client };
});

import { closePool, createListenerClient, withServiceRoleTransaction } from "./db.js";

const sqlsOf = (client: { query: ReturnType<typeof vi.fn> }) => client.query.mock.calls.map((c) => c[0] as string);

beforeEach(async () => {
  process.env.DATABASE_URL = "test-database-url";
  await closePool(); // fresh module singleton per test
  h.poolCtorCount = 0;
  h.connectCount = 0;
  h.endCount = 0;
  h.failOn = null;
  h.lastClient = null;
});

describe("withServiceRoleTransaction", () => {
  it("wraps fn in begin -> set local role service_role -> commit and releases the client", async () => {
    const result = await withServiceRoleTransaction(async (client) => {
      await client.query("select 1 as x");
      return 42;
    });

    expect(result).toBe(42);
    const c = h.lastClient!;
    expect(sqlsOf(c)).toEqual(["begin", "set local role service_role", "select 1 as x", "commit"]);
    expect(c.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and rethrows if fn throws, still releasing the client (event stays undispatched)", async () => {
    await expect(
      withServiceRoleTransaction(async () => {
        throw new Error("consumer boom");
      })
    ).rejects.toThrow("consumer boom");

    const c = h.lastClient!;
    expect(sqlsOf(c)).toEqual(["begin", "set local role service_role", "rollback"]);
    expect(c.release).toHaveBeenCalledTimes(1);
  });

  it("rethrows the ORIGINAL error even when the rollback itself fails (swallowed)", async () => {
    h.failOn = "rollback";
    await expect(
      withServiceRoleTransaction(async () => {
        throw new Error("original failure");
      })
    ).rejects.toThrow("original failure");
    expect(h.lastClient!.release).toHaveBeenCalledTimes(1);
  });

  it("reuses a single pool across calls; closePool ends it", async () => {
    await withServiceRoleTransaction(async () => {});
    await withServiceRoleTransaction(async () => {});
    expect(h.poolCtorCount).toBe(1); // lazy singleton, constructed once
    expect(h.connectCount).toBe(2);

    await closePool();
    expect(h.endCount).toBe(1);
  });

  it("throws a clear error when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    await closePool(); // force pool reconstruction so requireEnv runs again
    await expect(withServiceRoleTransaction(async () => {})).rejects.toThrow(/DATABASE_URL/);
  });
});

describe("createListenerClient", () => {
  it("connects a dedicated non-pooled client for LISTEN", async () => {
    const client = await createListenerClient();
    expect((client as unknown as { connect: ReturnType<typeof vi.fn> }).connect).toHaveBeenCalledTimes(1);
  });
});
