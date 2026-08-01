import { startBankTransferSweeper } from "./bankTransferSweeper.js";
import { startAuditDueWorker } from "./auditDueWorker.js";
import { startDispatchWorker } from "./dispatchWorker.js";
import { buildHealthServer } from "./health.js";
import { startInvoiceWorker } from "./invoiceWorker.js";
import { startLoyaltyWorker } from "./loyaltyWorker.js";
import { startPingPurgeWorker } from "./pingPurgeWorker.js";
import { startStatementWorker } from "./statementWorker.js";
import { createHealthWatcher } from "./healthWatcher.js";
import { logger } from "./logger.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

// Mailer/push/scheduler job runners land in S05 (PC-06/12).
const port = Number(process.env.WORKERS_HEALTH_PORT ?? 4020);

buildHealthServer().listen(port, "0.0.0.0", () => {
  logger.info({ port }, "workers health server listening");
});

// TC-PC10-003: S1 alerting on the two endpoints whose downtime the 15-minute
// page SLA is measured against (checkout/auth depends on api, live tracking
// on realtime).
const healthWatcher = createHealthWatcher([
  { service: "api", url: `${requireEnv("API_URL")}/api/v1/ready` },
  { service: "realtime", url: `${requireEnv("REALTIME_URL")}/health` }
]);
healthWatcher.start();

// FR-SF04-010 AC3 (S08): cancels bank-transfer orders with no proof/
// verification within the payment window and releases their reserved stock.
startBankTransferSweeper();

// DL-01 (S10): drains EV-PC-013/014 into task creation/auto-assign or recall.
startDispatchWorker();

// DL-03 FR-DL03-003 (S11): 30-day PDPL retention purge for location pings.
startPingPurgeWorker();

// DL-06/D-14 rule g (S12): raises a stock audit per driver once their cadence has elapsed.
startAuditDueWorker();

// SP-04/05 (S15): stamps a wholesale invoice's ZATCA delivery date on
// EV-PC-022, and sweeps invoices past due_at into 'overdue' daily.
startInvoiceWorker();

// SP-06/07 (S16): monthly statement generation + EV-PC-043 (loyalty
// reward -> credit note) consumer — no longer dormant as of S19/S20,
// loyaltyWorker.ts below is the real producer.
startStatementWorker();

// LE-01/05/06 (S19/S20): points earn/reverse, coupon release, early-pay +
// volume supplier rewards, points expiry, campaign scheduler.
startLoyaltyWorker();

setInterval(() => {
  logger.info("heartbeat");
}, 30_000);
