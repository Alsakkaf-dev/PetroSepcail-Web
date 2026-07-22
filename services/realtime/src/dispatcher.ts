import type { Client } from "pg";
import { runConsumers } from "./consumers/framework.js";
import { withServiceRoleTransaction } from "./db.js";
import type { EventEnvelope } from "./events.js";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";

// PC-EV-2 / FR-PC05-002: "A dispatcher drains core.outbox (every 10 s + on
// NOTIFY) ... a row is marked dispatched_at only after successful hand-off;
// failures retry with backoff." core.outbox (04-database-design §3.7) has no
// attempt-count/next-retry-at columns, so "backoff" here is the simplest
// reading the given schema supports: an undispatched row is naturally
// retried on the next poll/NOTIFY cycle (fixed ~10s interval), not
// exponential — inventing new columns beyond the S01 schema is out of scope.
const POLL_INTERVAL_MS = 10_000;
const MAX_ROWS_PER_DRAIN = 200; // safety bound so one drain call can't run forever

export type BroadcastFn = (event: EventEnvelope) => void;

interface OutboxRow {
  event_id: string;
  name: string;
  version: number;
  occurred_at: Date;
  actor_sub: string | null;
  actor_role: string | null;
  payload: Record<string, unknown>;
}

function toEnvelope(row: OutboxRow): EventEnvelope {
  return {
    eventId: row.event_id,
    name: row.name,
    version: row.version,
    occurredAt: row.occurred_at.toISOString(),
    actor: { sub: row.actor_sub, role: row.actor_role },
    payload: row.payload
  };
}

// One outbox row per transaction (not a shared multi-row batch transaction):
// isolates a single failing event's rollback to just that event — the
// consumers that already succeeded for OTHER rows stay committed, and a
// consumer that already fully succeeded for THIS row before a later
// consumer failed is safely re-run on retry (its own idempotency check
// no-ops it).
async function dispatchOne(): Promise<EventEnvelope | null> {
  return withServiceRoleTransaction(async (client) => {
    const res = await client.query<OutboxRow>(
      `select event_id, name, version, occurred_at, actor_sub, actor_role, payload
       from core.outbox where dispatched_at is null
       order by occurred_at
       limit 1
       for update skip locked`
    );
    const row = res.rows[0];
    if (!row) return null;

    const envelope = toEnvelope(row);
    await runConsumers(client, envelope);
    await client.query("update core.outbox set dispatched_at = now() where event_id = $1", [row.event_id]);
    // TC-PC10-004: event-dispatch lag = time between the event occurring
    // (occurred_at, set at outbox-insert time) and this dispatch completing.
    metrics.eventDispatchLag.observe((Date.now() - row.occurred_at.getTime()) / 1000);
    return envelope;
  });
}

export async function drainOutbox(broadcast: BroadcastFn): Promise<number> {
  let dispatchedCount = 0;
  for (let i = 0; i < MAX_ROWS_PER_DRAIN; i++) {
    let envelope: EventEnvelope | null;
    try {
      envelope = await dispatchOne();
    } catch (err) {
      logger.error({ err }, "dispatcher: error processing next outbox row; stopping this drain, will retry on next poll/NOTIFY");
      break;
    }
    if (!envelope) break;
    broadcast(envelope);
    dispatchedCount++;
  }
  return dispatchedCount;
}

export function startDispatcher(listenerClient: Client, broadcast: BroadcastFn): { stop: () => Promise<void> } {
  const drain = () => {
    drainOutbox(broadcast).catch((err) => logger.error({ err }, "dispatcher: drain failed"));
  };

  listenerClient.on("notification", (msg) => {
    if (msg.channel === "outbox") drain();
  });
  listenerClient.query("listen outbox").catch((err) => logger.error({ err }, "dispatcher: LISTEN outbox failed"));

  const interval = setInterval(drain, POLL_INTERVAL_MS);
  drain(); // catch up on anything queued before startup

  return {
    stop: async () => {
      clearInterval(interval);
      await listenerClient.end();
    }
  };
}
