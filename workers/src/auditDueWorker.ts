import { withServiceRoleTransaction } from "./db.js";
import { logger } from "./logger.js";

// DL-06/D-14 rule g (S12): raises a delivery.stock_audits row per active
// driver once their cadence (delivery.audit_interval_days — per-entity
// override or core.settings.audit_cadence_default) has elapsed since their
// last audit. Runs once a day — cadence is measured in days, no reason to
// poll faster. Suppliers (entity_kind='supplier') are not swept yet: SP-01
// (S14) is what will actually have supplier rows to audit; sweeping an
// empty set today would be a no-op loop, not a real feature.
export const AUDIT_DUE_INTERVAL_MS = 24 * 60 * 60_000; // 24h

interface DueDriver {
  id: string;
}

export async function raiseDueAudits(): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    const due = await client.query<DueDriver>(
      `select d.id
       from delivery.drivers d
       where d.status = 'active'
         and not exists (select 1 from delivery.stock_audits a where a.entity_kind = 'driver' and a.entity_id = d.id and a.status = 'open')
         and (
           (select coalesce(max(closed_at), max(opened_at)) from delivery.stock_audits a
            where a.entity_kind = 'driver' and a.entity_id = d.id) is null
           or
           (select coalesce(max(closed_at), max(opened_at)) from delivery.stock_audits a
            where a.entity_kind = 'driver' and a.entity_id = d.id)
             < now() - (delivery.audit_interval_days('driver', d.id) || ' days')::interval
         )`
    );

    for (const driver of due.rows) {
      await client.query("insert into delivery.stock_audits (entity_kind, entity_id, status) values ('driver', $1, 'open')", [
        driver.id
      ]);
    }
    return due.rows.length;
  });
}

export function startAuditDueWorker(): { stop: () => void } {
  const interval = setInterval(() => {
    raiseDueAudits()
      .then((count) => {
        if (count > 0) logger.info({ count }, "audit-due-worker: raised due audits");
      })
      .catch((err) => logger.error({ err }, "audit-due-worker: sweep failed"));
  }, AUDIT_DUE_INTERVAL_MS);
  return { stop: () => clearInterval(interval) };
}
