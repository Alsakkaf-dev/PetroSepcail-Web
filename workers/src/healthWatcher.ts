import { findOpenIncident, openIncident, resolveIncident } from "@petrospecial/observability";
import { withServiceRoleTransaction } from "./db.js";
import { logger } from "./logger.js";

export interface HealthTarget {
  service: string;
  url: string;
}

export const POLL_INTERVAL_MS = 30_000;
// 2 consecutive failures on a 30s poll = an S1 opens within 60s, well inside
// FR-PC10-003's 15-minute page-window SLA.
export const FAILURE_THRESHOLD = 2;

async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface HealthWatcher {
  pollOnce(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createHealthWatcher(targets: HealthTarget[]): HealthWatcher {
  const consecutiveFailures = new Map<string, number>();

  async function pollOnce(): Promise<void> {
    for (const target of targets) {
      const healthy = await checkHealth(target.url);

      if (healthy) {
        const hadFailures = (consecutiveFailures.get(target.service) ?? 0) >= FAILURE_THRESHOLD;
        consecutiveFailures.set(target.service, 0);
        if (hadFailures) {
          await withServiceRoleTransaction(async (client) => {
            const open = await findOpenIncident(client, target.service);
            if (open) {
              await resolveIncident(client, open.id);
              logger.info({ service: target.service, incidentId: open.id }, "health-watcher: incident resolved");
            }
          });
        }
        continue;
      }

      const nextFailures = (consecutiveFailures.get(target.service) ?? 0) + 1;
      consecutiveFailures.set(target.service, nextFailures);
      logger.warn(
        { service: target.service, url: target.url, consecutiveFailures: nextFailures },
        "health-watcher: check failed"
      );

      if (nextFailures === FAILURE_THRESHOLD) {
        await withServiceRoleTransaction(async (client) => {
          const existing = await findOpenIncident(client, target.service);
          if (!existing) {
            const id = await openIncident(client, {
              severity: "S1",
              service: target.service,
              message: `${target.url} failed ${nextFailures} consecutive health checks — see ops/dr-runbook.md`
            });
            logger.error({ service: target.service, incidentId: id }, "health-watcher: S1 incident opened");
          }
        });
      }
    }
  }

  let timer: NodeJS.Timeout | undefined;

  function start(): void {
    timer = setInterval(() => {
      pollOnce().catch((err) => logger.error({ err }, "health-watcher: poll cycle failed"));
    }, POLL_INTERVAL_MS);
  }

  function stop(): void {
    clearInterval(timer);
  }

  return { pollOnce, start, stop };
}
