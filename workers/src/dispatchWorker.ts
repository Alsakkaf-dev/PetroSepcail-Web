import { withServiceRoleTransaction } from "./db.js";
import { logger } from "./logger.js";

// DL-01 (03-sdd.md §3 "Assignment worker"): drains core.outbox for the two
// events dispatch reacts to — EV-PC-013 (creates + auto-assigns a task) and
// EV-PC-014 (recalls one). EV-PC-015 (orders.return.approved -> DL-01
// creates a pickup task) is deliberately not consumed here: nothing in this
// codebase produces it yet (SF-08/09 returns are S13, AC-05 approval is
// S18), so there is no real event to react to and no way to exercise this
// path — building a consumer for an event nothing emits would be dead code,
// not a real feature. Polls the outbox directly (not LISTEN/NOTIFY) — same
// choice bankTransferSweeper.ts already made for this codebase's worker
// tier; a 5s interval keeps dispatch feeling responsive to a driver without
// needing the realtime service.
export const DISPATCH_POLL_INTERVAL_MS = 5_000;

interface OutboxRow {
  event_id: string;
  name: string;
  payload: { order_id: string };
}

export async function drainDispatchOutbox(): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    const rows = await client.query<OutboxRow>(
      `select event_id, name, payload from core.outbox
       where dispatched_at is null and name in ('orders.order.ready_for_pickup', 'orders.order.cancelled')
       order by occurred_at
       for update skip locked`
    );

    for (const row of rows.rows) {
      try {
        if (row.name === "orders.order.ready_for_pickup") {
          await client.query("select delivery.dispatch_order($1, $2)", [row.payload.order_id, row.event_id]);
        } else {
          await client.query("select delivery.recall_task($1)", [row.payload.order_id]);
        }
        await client.query("update core.outbox set dispatched_at = now() where event_id = $1", [row.event_id]);
      } catch (err) {
        // Leave dispatched_at null so the next poll retries this row — same
        // fail-open-and-retry posture as the rest of this worker tier
        // (healthWatcher, bankTransferSweeper's own try/catch-per-item
        // pattern would apply here too if it looped per-row instead of
        // per-sweep; this loop already does).
        logger.error({ err, eventId: row.event_id, name: row.name }, "dispatch-worker: failed to process outbox row");
      }
    }

    return rows.rows.length;
  });
}

export function startDispatchWorker(): { stop: () => void } {
  const interval = setInterval(() => {
    drainDispatchOutbox().catch((err) => logger.error({ err }, "dispatch-worker: drain failed"));
  }, DISPATCH_POLL_INTERVAL_MS);
  return { stop: () => clearInterval(interval) };
}
