import { withServiceRoleTransaction } from "./db.js";
import { logger } from "./logger.js";

// DL-03 FR-DL03-003 (S11) — PDPL retention: location pings are personal data
// tied to a driver's movement and must not be kept indefinitely. Runs far
// less often than dispatch/ping cadence itself (this is cleanup, not a
// latency-sensitive path) — once an hour is more than enough headroom
// against a 30-day window.
export const PING_PURGE_INTERVAL_MS = 60 * 60_000; // 1h

export async function purgeExpiredPings(): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    const res = await client.query("delete from delivery.location_pings where at < now() - interval '30 days'");
    return res.rowCount ?? 0;
  });
}

export function startPingPurgeWorker(): { stop: () => void } {
  const interval = setInterval(() => {
    purgeExpiredPings()
      .then((count) => {
        if (count > 0) logger.info({ count }, "ping-purge-worker: purged expired location pings");
      })
      .catch((err) => logger.error({ err }, "ping-purge-worker: purge failed"));
  }, PING_PURGE_INTERVAL_MS);
  return { stop: () => clearInterval(interval) };
}
