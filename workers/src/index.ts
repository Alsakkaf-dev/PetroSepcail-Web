import { buildHealthServer } from "./health.js";

// Mailer/push/scheduler job runners land in S05 (PC-06/12); zatca dispatch in S15.
const port = Number(process.env.WORKERS_HEALTH_PORT ?? 4020);

buildHealthServer().listen(port, "0.0.0.0");

setInterval(() => {
  console.log(`[workers] heartbeat ${new Date().toISOString()}`);
}, 30_000);
