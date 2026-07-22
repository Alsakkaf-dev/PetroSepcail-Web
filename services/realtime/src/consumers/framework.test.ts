import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearConsumers, listConsumers, registerConsumer, runConsumers } from "./framework.js";
import type { EventEnvelope } from "../events.js";

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: "22222222-2222-2222-2222-222222222222",
    name: "demo.event",
    version: 1,
    occurredAt: new Date().toISOString(),
    actor: { sub: null, role: null },
    payload: {},
    ...overrides
  };
}

interface QueryCall {
  sql: string;
  params: unknown[];
}

// Faithful in-memory model of core.processed_events (db/migrations/0012):
// the dedup SELECT reports a (consumer_name, event_id) pair as processed only
// after this same client has run the INSERT for it — so idempotency across
// redeliveries is exercised for real, not stubbed with a fixed return value.
function makeLedgerClient() {
  const ledger = new Set<string>();
  const calls: QueryCall[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("select 1 from core.processed_events")) {
      const key = `${params[0] as string}::${params[1] as string}`;
      return { rowCount: ledger.has(key) ? 1 : 0, rows: [] };
    }
    if (sql.includes("insert into core.processed_events")) {
      ledger.add(`${params[0] as string}::${params[1] as string}`);
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });
  return { query, calls, ledger };
}

const inserts = (calls: QueryCall[]) => calls.filter((c) => c.sql.includes("insert into core.processed_events"));

describe("consumer framework: registry", () => {
  beforeEach(() => clearConsumers());

  it("registers, lists in insertion order, and clears", () => {
    expect(listConsumers()).toEqual([]);
    registerConsumer("a", async () => {});
    registerConsumer("b", async () => {});
    expect(listConsumers()).toEqual(["a", "b"]);
    clearConsumers();
    expect(listConsumers()).toEqual([]);
  });

  it("re-registering the same name replaces the handler (no duplicate entry)", () => {
    registerConsumer("dup", async () => {});
    registerConsumer("dup", async () => {});
    expect(listConsumers()).toEqual(["dup"]);
  });
});

describe("consumer framework: runConsumers dedup / ordering", () => {
  beforeEach(() => clearConsumers());

  it("runs a not-yet-processed consumer, then records it — in SELECT -> handler -> INSERT order", async () => {
    const handler = vi.fn(async () => {});
    registerConsumer("c1", handler);
    const client = makeLedgerClient();
    const env = envelope({ eventId: "e-1" });

    await runConsumers(client as never, env);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(env);
    // dedup SELECT then processed_events INSERT, both keyed (consumer, event_id)
    expect(client.calls[0]?.sql).toContain("select 1 from core.processed_events");
    expect(client.calls[0]?.params).toEqual(["c1", "e-1"]);
    expect(client.calls[1]?.sql).toContain("insert into core.processed_events");
    expect(client.calls[1]?.params).toEqual(["c1", "e-1"]);
    // strict ordering: the ledger read happens before the handler, the ledger
    // write strictly after it (so a crash mid-handler leaves no processed row).
    const selectOrder = client.query.mock.invocationCallOrder[0]!;
    const insertOrder = client.query.mock.invocationCallOrder[1]!;
    const handlerOrder = handler.mock.invocationCallOrder[0]!;
    expect(selectOrder).toBeLessThan(handlerOrder);
    expect(handlerOrder).toBeLessThan(insertOrder);
  });

  it("skips a consumer that already processed this event_id (no handler, no insert)", async () => {
    const handler = vi.fn(async () => {});
    registerConsumer("c1", handler);
    const client = makeLedgerClient();
    client.ledger.add("c1::e-1"); // pre-seed: already processed

    await runConsumers(client as never, envelope({ eventId: "e-1" }));

    expect(handler).not.toHaveBeenCalled();
    expect(inserts(client.calls)).toHaveLength(0);
    expect(client.calls).toHaveLength(1); // only the dedup SELECT ran
  });

  it("processes each consumer independently against the same event", async () => {
    const alreadyH = vi.fn(async () => {});
    const freshH = vi.fn(async () => {});
    registerConsumer("already", alreadyH);
    registerConsumer("fresh", freshH);
    const client = makeLedgerClient();
    client.ledger.add("already::e-1");

    await runConsumers(client as never, envelope({ eventId: "e-1" }));

    expect(alreadyH).not.toHaveBeenCalled();
    expect(freshH).toHaveBeenCalledTimes(1);
    expect(inserts(client.calls).map((c) => c.params)).toEqual([["fresh", "e-1"]]);
  });

  it("delivering the same event twice runs each handler exactly once (idempotent)", async () => {
    const handler = vi.fn(async () => {});
    registerConsumer("c1", handler);
    const client = makeLedgerClient();
    const env = envelope({ eventId: "e-1" });

    await runConsumers(client as never, env);
    await runConsumers(client as never, env); // redelivery

    expect(handler).toHaveBeenCalledTimes(1);
    expect(inserts(client.calls)).toHaveLength(1);
  });

  it("a distinct event_id re-runs the consumer", async () => {
    const handler = vi.fn(async () => {});
    registerConsumer("c1", handler);
    const client = makeLedgerClient();

    await runConsumers(client as never, envelope({ eventId: "e-1" }));
    await runConsumers(client as never, envelope({ eventId: "e-2" }));

    expect(handler).toHaveBeenCalledTimes(2);
    expect(inserts(client.calls).map((c) => c.params)).toEqual([
      ["c1", "e-1"],
      ["c1", "e-2"]
    ]);
  });

  it("a throwing handler propagates and leaves no processed row, and aborts later consumers", async () => {
    const boom = vi.fn(async () => {
      throw new Error("handler blew up");
    });
    const after = vi.fn(async () => {});
    registerConsumer("boom", boom);
    registerConsumer("after", after);
    const client = makeLedgerClient();

    await expect(runConsumers(client as never, envelope({ eventId: "e-1" }))).rejects.toThrow("handler blew up");

    // The failing consumer's processed-row insert never ran (the event stays
    // undispatched so the dispatcher retries it), and the next consumer in the
    // registry never got a turn — the whole run aborts, matching the
    // one-transaction-per-outbox-row rollback contract in dispatcher.ts.
    expect(after).not.toHaveBeenCalled();
    expect(inserts(client.calls)).toHaveLength(0);
  });
});
