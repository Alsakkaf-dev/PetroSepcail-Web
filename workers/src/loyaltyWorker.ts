import { withServiceRoleTransaction } from "./db.js";
import { logger } from "./logger.js";

// 50-loyalty-engine/08-implementation-guide.md §2/3/5 (LE-01/05/06, S19/S20).
// Same outbox-polling shape every other worker in this tier already uses
// (dispatchWorker.ts/invoiceWorker.ts).
export const LOYALTY_POLL_INTERVAL_MS = 5_000;
// Ticks daily; sweep_expiry/runVolumeClose only *act* once their own real
// boundary (a month, a quarter) has actually passed, via their own cutoff math.
export const LOYALTY_DAILY_INTERVAL_MS = 24 * 60 * 60_000;

interface PaidRow {
  event_id: string;
  payload: { order_id: string; method: string; amount: string };
}
interface CancelledRow {
  event_id: string;
  payload: { order_id: string };
}
interface ReturnApprovedRow {
  event_id: string;
  payload: { return_id: string; order_id: string; refund_amount: string };
}
interface InvoiceSettledRow {
  event_id: string;
  payload: { invoice_id: string; supplier_id: string; days_to_settle: number };
}

export async function drainLoyaltyOutbox(): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    let processed = 0;

    // EV-PC-011 (LE-01 earn) — retail only; custody/wholesale never earn.
    const paid = await client.query<PaidRow>(
      `select event_id, payload from core.outbox
       where dispatched_at is null and name = 'orders.order.paid'
       order by occurred_at for update skip locked`
    );
    for (const row of paid.rows) {
      try {
        const order = await client.query<{ user_id: string; subtotal: string; kind: string }>(
          "select user_id, subtotal, kind from orders.orders where id = $1",
          [row.payload.order_id]
        );
        if (order.rows[0]?.kind === "retail") {
          await client.query("select loyalty.earn_on_paid($1, $2, $3, $4)", [
            order.rows[0].user_id,
            row.payload.order_id,
            order.rows[0].subtotal,
            row.event_id
          ]);
        }
        await client.query("update core.outbox set dispatched_at = now() where event_id = $1", [row.event_id]);
        processed++;
      } catch (err) {
        logger.error({ err, eventId: row.event_id }, "loyalty-worker: failed to process orders.order.paid");
      }
    }

    // EV-PC-014 (LE-01 full reversal + LE-02 coupon release) — cancellation.
    const cancelled = await client.query<CancelledRow>(
      `select event_id, payload from core.outbox
       where dispatched_at is null and name = 'orders.order.cancelled'
       order by occurred_at for update skip locked`
    );
    for (const row of cancelled.rows) {
      try {
        await client.query("select loyalty.reverse_points($1, $2)", [row.payload.order_id, row.event_id]);
        await client.query("select loyalty.restore_redemption($1, $2)", [row.payload.order_id, row.event_id]);
        await client.query("select loyalty.release_coupon_redemption($1)", [row.payload.order_id]);
        await client.query("update core.outbox set dispatched_at = now() where event_id = $1", [row.event_id]);
        processed++;
      } catch (err) {
        logger.error({ err, eventId: row.event_id }, "loyalty-worker: failed to process orders.order.cancelled");
      }
    }

    // EV-PC-015 (LE-01 proportional reversal) — partial return, DEFERRED-DECISIONS item 6.
    const returned = await client.query<ReturnApprovedRow>(
      `select event_id, payload from core.outbox
       where dispatched_at is null and name = 'orders.return.approved'
       order by occurred_at for update skip locked`
    );
    for (const row of returned.rows) {
      try {
        await client.query("select loyalty.reverse_points_partial($1, $2, $3)", [row.payload.order_id, row.payload.refund_amount, row.event_id]);
        await client.query("update core.outbox set dispatched_at = now() where event_id = $1", [row.event_id]);
        processed++;
      } catch (err) {
        logger.error({ err, eventId: row.event_id }, "loyalty-worker: failed to process orders.return.approved");
      }
    }

    // EV-PC-032 (LE-05 early-pay reward) — settled wholesale invoice.
    const settled = await client.query<InvoiceSettledRow>(
      `select event_id, payload from core.outbox
       where dispatched_at is null and name = 'credit.invoice.settled'
       order by occurred_at for update skip locked`
    );
    for (const row of settled.rows) {
      try {
        const invoice = await client.query<{ total: string }>("select total from credit.invoices where id = $1", [row.payload.invoice_id]);
        if (invoice.rows[0]) {
          await client.query("select loyalty.grant_early_pay_reward($1, $2, $3, $4)", [
            row.payload.supplier_id,
            row.payload.invoice_id,
            invoice.rows[0].total,
            row.payload.days_to_settle
          ]);
        }
        await client.query("update core.outbox set dispatched_at = now() where event_id = $1", [row.event_id]);
        processed++;
      } catch (err) {
        logger.error({ err, eventId: row.event_id }, "loyalty-worker: failed to process credit.invoice.settled");
      }
    }

    return processed;
  });
}

export async function runExpirySweep(): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    const res = await client.query<{ sweep_expiry: number }>("select loyalty.sweep_expiry() as sweep_expiry");
    return res.rows[0]?.sweep_expiry ?? 0;
  });
}

export async function runCampaignSweep(): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    const res = await client.query<{ sweep_campaigns: number }>("select loyalty.sweep_campaigns() as sweep_campaigns");
    return res.rows[0]?.sweep_campaigns ?? 0;
  });
}

// LE-06 quarterly volume close — runs on the daily tick but only acts when
// today is the first day of a new quarter (Jan/Apr/Jul/Oct 1st), same
// "tick daily, act on the real boundary" shape sweep_expiry's own monthly
// cutoff math already uses.
export async function runVolumeClose(now: Date = new Date()): Promise<number> {
  const month = now.getUTCMonth(); // 0-indexed
  if (now.getUTCDate() !== 1 || month % 3 !== 0) return 0;
  const quarterStart = new Date(Date.UTC(now.getUTCFullYear(), month - 3, 1));
  const quarter = `${quarterStart.getUTCFullYear()}-Q${Math.floor(quarterStart.getUTCMonth() / 3) + 1}`;
  const quarterEnd = new Date(Date.UTC(now.getUTCFullYear(), month, 0));

  return withServiceRoleTransaction(async (client) => {
    const suppliers = await client.query<{ id: string; purchases: string }>(
      `select s.id, coalesce(sum(o.total), 0) as purchases
       from credit.suppliers s
       left join orders.orders o on o.supplier_id = s.id and o.kind = 'wholesale' and o.status not in ('cancelled')
         and o.placed_at::date between $1 and $2
       where s.status = 'active'
       group by s.id`,
      [quarterStart.toISOString().slice(0, 10), quarterEnd.toISOString().slice(0, 10)]
    );
    let count = 0;
    for (const s of suppliers.rows) {
      try {
        await client.query("select loyalty.grant_volume_reward($1, $2, $3)", [s.id, quarter, s.purchases]);
        count++;
      } catch (err) {
        logger.error({ err, supplierId: s.id }, "loyalty-worker: failed to grant volume reward");
      }
    }
    return count;
  });
}

export function startLoyaltyWorker(): { stop: () => void } {
  const drainInterval = setInterval(() => {
    drainLoyaltyOutbox().catch((err) => logger.error({ err }, "loyalty-worker: drain failed"));
  }, LOYALTY_POLL_INTERVAL_MS);
  const dailyInterval = setInterval(() => {
    runExpirySweep().catch((err) => logger.error({ err }, "loyalty-worker: expiry sweep failed"));
    runCampaignSweep().catch((err) => logger.error({ err }, "loyalty-worker: campaign sweep failed"));
    runVolumeClose().catch((err) => logger.error({ err }, "loyalty-worker: volume close failed"));
  }, LOYALTY_DAILY_INTERVAL_MS);
  return {
    stop: () => {
      clearInterval(drainInterval);
      clearInterval(dailyInterval);
    }
  };
}
