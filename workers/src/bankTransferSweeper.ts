import { withServiceRoleTransaction } from "./db.js";
import { logger } from "./logger.js";

// FR-SF04-010 AC3 (S08): "no proof/verification within the payment window of
// 48h -> the System sweeper cancels the order and releases any reserved
// stock/points" (03-sdd.md §4). Points release is a no-op today (LE-01
// doesn't exist until S19 — nothing was ever reserved to release).
export const SWEEP_INTERVAL_MS = 10 * 60_000; // 10 min: coarse enough for a 48h deadline

interface SweptOrder {
  id: string;
}

export async function sweepExpiredBankTransfers(): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    const windowRes = await client.query<{ get_setting: string }>(
      "select core.get_setting('bank_transfer_window_hours') as get_setting"
    );
    const windowHours = Number(windowRes.rows[0]?.get_setting ?? 48);

    const expired = await client.query<SweptOrder>(
      `select o.id from orders.orders o
       where o.status = 'pending_payment' and o.payment_method = 'bank_transfer'
         and o.placed_at < now() - ($1 || ' hours')::interval
         and not exists (
           select 1 from orders.payments p where p.order_id = o.id and p.status in ('verified', 'collected')
         )`,
      [windowHours]
    );

    for (const order of expired.rows) {
      const lines = await client.query<{ pack_size_id: string; qty: number }>(
        "select pack_size_id, qty from orders.order_lines where order_id = $1",
        [order.id]
      );
      for (const line of lines.rows) {
        await client.query("select catalog.release_stock($1, $2)", [line.pack_size_id, line.qty]);
      }
      await client.query("update orders.orders set status = 'cancelled' where id = $1", [order.id]);
      await client.query(
        `insert into core.outbox (name, version, payload)
         values ('orders.order.cancelled', 1, $1)`,
        [JSON.stringify({ order_id: order.id, reason_code: "payment_window_expired", by_role: "system" })]
      );
      logger.info({ orderId: order.id }, "bank-transfer-sweeper: cancelled expired pending_payment order");
    }

    return expired.rows.length;
  });
}

export function startBankTransferSweeper(): { stop: () => void } {
  const interval = setInterval(() => {
    sweepExpiredBankTransfers().catch((err) => logger.error({ err }, "bank-transfer-sweeper: sweep failed"));
  }, SWEEP_INTERVAL_MS);
  return { stop: () => clearInterval(interval) };
}
