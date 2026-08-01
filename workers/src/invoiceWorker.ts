import { withServiceRoleTransaction } from "./db.js";
import { logger } from "./logger.js";

// SP-04 (S15) Task SP-INV-2: EV-PC-022 (delivery.task.delivered) consumer —
// stamps the real delivery date onto the matching wholesale invoice
// (credit.stamp_delivery_date is a pure-SQL no-op for retail orders, which
// never have a credit.invoices row at all — safe to drain unconditionally
// rather than filtering by kind here). Invoice ISSUANCE itself is not
// drained from the outbox here: it needs services/api's zatca/fatooraSim.ts
// TS module (TLV/HMAC), which this package cannot depend on (workers only
// ever depends on pg + observability, same boundary every other worker in
// this tier respects) — issuance instead happens synchronously in
// services/api/src/routes/supplier.ts's POST /supplier/orders handler,
// the only real producer of orders.order.confirmed{kind:wholesale} in the
// system. Same outbox-polling shape dispatchWorker.ts already established.
export const INVOICE_POLL_INTERVAL_MS = 5_000;
export const OVERDUE_SWEEP_INTERVAL_MS = 24 * 60 * 60_000; // 24h — due_at is date-grained, no reason to poll faster

interface DeliveredRow {
  event_id: string;
  payload: { order_id: string; delivered_at: string };
}

export async function drainInvoiceOutbox(): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    const rows = await client.query<DeliveredRow>(
      `select event_id, payload from core.outbox
       where dispatched_at is null and name = 'delivery.task.delivered'
       order by occurred_at
       for update skip locked`
    );

    for (const row of rows.rows) {
      try {
        await client.query("select credit.stamp_delivery_date($1, $2)", [row.payload.order_id, row.payload.delivered_at]);
        await client.query("update core.outbox set dispatched_at = now() where event_id = $1", [row.event_id]);
      } catch (err) {
        logger.error({ err, eventId: row.event_id }, "invoice-worker: failed to stamp delivery date");
      }
    }

    return rows.rows.length;
  });
}

// SP-05 Task SP-PAY-2: daily day-31 dunning sweep (D-06 net-30 + this
// project's own day-31 convention, matching the implementation guide's own
// "daily worker day-31" framing).
export async function sweepOverdueInvoices(): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    const res = await client.query<{ mark_overdue: number }>("select credit.mark_overdue() as mark_overdue");
    return res.rows[0]?.mark_overdue ?? 0;
  });
}

export function startInvoiceWorker(): { stop: () => void } {
  const drainInterval = setInterval(() => {
    drainInvoiceOutbox().catch((err) => logger.error({ err }, "invoice-worker: drain failed"));
  }, INVOICE_POLL_INTERVAL_MS);
  const overdueInterval = setInterval(() => {
    sweepOverdueInvoices()
      .then((count) => {
        if (count > 0) logger.info({ count }, "invoice-worker: marked invoices overdue");
      })
      .catch((err) => logger.error({ err }, "invoice-worker: overdue sweep failed"));
  }, OVERDUE_SWEEP_INTERVAL_MS);
  return {
    stop: () => {
      clearInterval(drainInterval);
      clearInterval(overdueInterval);
    }
  };
}
