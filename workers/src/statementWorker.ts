import { withServiceRoleTransaction } from "./db.js";
import { logger } from "./logger.js";

// SP-06 Task SP-STMT-1: monthly statement generator for every active
// supplier, previous calendar month. Runs on a daily tick (same interval
// shape every other worker in this tier uses) but only acts on the month's
// first day -- credit.generate_statement (0062) is idempotent per period
// regardless, so a missed/late tick self-heals on the next run.
export const STATEMENT_TICK_INTERVAL_MS = 24 * 60 * 60_000; // 24h

export async function generateMonthlyStatements(now: Date = new Date()): Promise<number> {
  if (now.getUTCDate() !== 1) return 0;
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); // last day of prior month
  const periodStart = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));

  return withServiceRoleTransaction(async (client) => {
    const suppliers = await client.query<{ id: string }>("select id from credit.suppliers where status = 'active'");
    for (const s of suppliers.rows) {
      try {
        await client.query("select credit.generate_statement($1, $2, $3)", [
          s.id,
          periodStart.toISOString().slice(0, 10),
          periodEnd.toISOString().slice(0, 10)
        ]);
      } catch (err) {
        logger.error({ err, supplierId: s.id }, "statement-worker: failed to generate statement");
      }
    }
    return suppliers.rows.length;
  });
}

// SP-07 Task SP-EARLY-1: EV-PC-043 (loyalty.reward.granted) consumer. No
// longer dormant as of S19/S20 -- loyaltyWorker.ts's grant_early_pay_reward/
// grant_volume_reward (0070/0071) are the real producers, draining
// credit.invoice.settled/the quarterly volume close respectively.
interface RewardGrantedRow {
  event_id: string;
  payload: { supplier_id: string; kind: "early_pay" | "volume"; value_sar: number; source_ref: string };
}

export async function drainLoyaltyRewardOutbox(): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    const rows = await client.query<RewardGrantedRow>(
      `select event_id, payload from core.outbox
       where dispatched_at is null and name = 'loyalty.reward.granted'
       order by occurred_at
       for update skip locked`
    );
    for (const row of rows.rows) {
      try {
        if (row.payload.supplier_id) {
          await client.query("select credit.grant_loyalty_credit_note($1, $2, $3, $4)", [
            row.payload.supplier_id,
            row.payload.kind,
            row.payload.value_sar,
            row.payload.source_ref
          ]);
        }
        await client.query("update core.outbox set dispatched_at = now() where event_id = $1", [row.event_id]);
      } catch (err) {
        logger.error({ err, eventId: row.event_id }, "statement-worker: failed to process loyalty reward");
      }
    }
    return rows.rows.length;
  });
}

export function startStatementWorker(): { stop: () => void } {
  const interval = setInterval(() => {
    generateMonthlyStatements().catch((err) => logger.error({ err }, "statement-worker: monthly generation failed"));
    drainLoyaltyRewardOutbox().catch((err) => logger.error({ err }, "statement-worker: reward drain failed"));
  }, STATEMENT_TICK_INTERVAL_MS);
  return { stop: () => clearInterval(interval) };
}
