import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The dispatcher's DB, logging and metrics side-effects are mocked so the
// drain/mapping/error-handling control flow can be unit-tested with no
// Postgres (the real outbox -> NOTIFY -> WS path is covered by the Docker
// e2e suite, roundTrip.e2e.test.ts).
const h = vi.hoisted(() => ({
  client: null as { query: ReturnType<typeof vi.fn> } | null,
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  observe: vi.fn()
}));

vi.mock("./db.js", () => ({
  withServiceRoleTransaction: async (fn: (client: unknown) => Promise<unknown>) => fn(h.client)
}));
vi.mock("./logger.js", () => ({
  logger: { error: h.loggerError, info: h.loggerInfo, warn: vi.fn(), debug: vi.fn() }
}));
vi.mock("./metrics.js", () => ({
  metrics: { eventDispatchLag: { observe: h.observe } }
}));

import { drainOutbox, startDispatcher } from "./dispatcher.js";
import { clearConsumers } from "./consumers/framework.js";

interface OutboxRow {
  event_id: string;
  name: string;
  version: number;
  occurred_at: Date;
  actor_sub: string | null;
  actor_role: string | null;
  payload: Record<string, unknown>;
}

function row(i: number, overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    event_id: `e-${i}`,
    name: "demo.event",
    version: 1,
    occurred_at: new Date("2026-07-22T00:00:00.000Z"),
    actor_sub: null,
    actor_role: null,
    payload: { i },
    ...overrides
  };
}

// In-memory core.outbox: each SELECT hands out the next undispatched row
// (mirrors `order by occurred_at limit 1 for update skip locked`), UPDATE
// records the row as dispatched. `throwOnSelect` forces the Nth SELECT to
// throw, to exercise the drain's per-row error isolation.
function makeOutbox(rows: OutboxRow[], opts: { throwOnSelect?: number } = {}) {
  const remaining = [...rows];
  const dispatched: string[] = [];
  let selectCount = 0;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/select[\s\S]*from core\.outbox/i.test(sql)) {
      selectCount += 1;
      if (opts.throwOnSelect === selectCount) throw new Error("outbox select failed");
      const next = remaining.shift();
      return { rows: next ? [next] : [] };
    }
    if (/update core\.outbox set dispatched_at/i.test(sql)) {
      dispatched.push(params[0] as string);
      return { rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { query, dispatched };
}

beforeEach(() => {
  clearConsumers(); // empty registry -> runConsumers is a no-op, keeps the mock outbox simple
  h.loggerError.mockClear();
  h.loggerInfo.mockClear();
  h.observe.mockClear();
  h.client = null;
});

describe("drainOutbox", () => {
  it("drains every undispatched row, broadcasts each, marks it dispatched, and returns the count", async () => {
    const outbox = makeOutbox([row(1), row(2)]);
    h.client = outbox;
    const broadcast = vi.fn();

    const count = await drainOutbox(broadcast);

    expect(count).toBe(2);
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(outbox.dispatched).toEqual(["e-1", "e-2"]);
    expect(h.observe).toHaveBeenCalledTimes(2);
    expect(h.observe).toHaveBeenCalledWith(expect.any(Number));
  });

  it("maps an outbox row into the 06-integration-contracts envelope shape", async () => {
    h.client = makeOutbox([
      row(7, {
        event_id: "abc",
        name: "identity.user.registered",
        version: 3,
        occurred_at: new Date("2026-07-22T00:00:00.000Z"),
        actor_sub: "u-9",
        actor_role: "admin",
        payload: { hello: "world" }
      })
    ]);
    const broadcast = vi.fn();

    await drainOutbox(broadcast);

    expect(broadcast).toHaveBeenCalledWith({
      eventId: "abc",
      name: "identity.user.registered",
      version: 3,
      occurredAt: "2026-07-22T00:00:00.000Z",
      actor: { sub: "u-9", role: "admin" },
      payload: { hello: "world" }
    });
  });

  it("returns 0 and never broadcasts when the outbox is empty", async () => {
    h.client = makeOutbox([]);
    const broadcast = vi.fn();

    const count = await drainOutbox(broadcast);

    expect(count).toBe(0);
    expect(broadcast).not.toHaveBeenCalled();
    expect(h.observe).not.toHaveBeenCalled();
  });

  it("stops the drain on a per-row error but keeps prior progress and does not throw", async () => {
    // row 1 dispatches fine; the 2nd transaction's SELECT throws.
    h.client = makeOutbox([row(1), row(2)], { throwOnSelect: 2 });
    const broadcast = vi.fn();

    const count = await drainOutbox(broadcast);

    expect(count).toBe(1); // row 1's progress is preserved
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(h.loggerError).toHaveBeenCalledTimes(1); // the failure was logged, not thrown
  });

  it("respects the MAX_ROWS_PER_DRAIN safety bound (200) even if more rows exist", async () => {
    const outbox = makeOutbox(Array.from({ length: 205 }, (_, i) => row(i)));
    h.client = outbox;
    const broadcast = vi.fn();

    const count = await drainOutbox(broadcast);

    expect(count).toBe(200);
    expect(broadcast).toHaveBeenCalledTimes(200);
    expect(outbox.dispatched).toHaveLength(200);
  });
});

describe("startDispatcher", () => {
  function makeListener() {
    return {
      on: vi.fn(),
      query: vi.fn().mockResolvedValue({}),
      end: vi.fn().mockResolvedValue(undefined)
    };
  }

  afterEach(() => vi.useRealTimers());

  it("registers a NOTIFY handler, issues LISTEN outbox, runs an initial catch-up drain, and stop() ends the client", async () => {
    h.client = makeOutbox([]);
    const listener = makeListener();
    const broadcast = vi.fn();

    const handle = startDispatcher(listener as never, broadcast);

    expect(listener.on).toHaveBeenCalledWith("notification", expect.any(Function));
    expect(listener.query).toHaveBeenCalledWith("listen outbox");
    await vi.waitFor(() => expect(h.client!.query).toHaveBeenCalled()); // initial drain hit the outbox

    await handle.stop();
    expect(listener.end).toHaveBeenCalledTimes(1); // the dedicated LISTEN client is closed on shutdown
  });

  it("only drains on a NOTIFY for the 'outbox' channel", async () => {
    h.client = makeOutbox([]);
    const listener = makeListener();
    const broadcast = vi.fn();

    const handle = startDispatcher(listener as never, broadcast);
    await vi.waitFor(() => expect(h.client!.query).toHaveBeenCalled()); // let the startup drain settle
    const notify = listener.on.mock.calls[0]![1] as (msg: { channel: string }) => void;
    h.client.query.mockClear();

    notify({ channel: "some-other-channel" });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.client.query).not.toHaveBeenCalled();

    notify({ channel: "outbox" });
    await vi.waitFor(() => expect(h.client!.query).toHaveBeenCalled());

    await handle.stop();
  });
});
