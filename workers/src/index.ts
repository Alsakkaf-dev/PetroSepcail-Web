import { createLogger } from "@petrospecial/observability";
import { buildHealthServer } from "./health.js";

const logger = createLogger("workers");

// Mailer/push/scheduler job runners land in S05 (PC-06/12); zatca dispatch in S15.
const port = Number(process.env.WORKERS_HEALTH_PORT ?? 4020);

buildHealthServer().listen(port, "0.0.0.0", () => {
  logger.info({ port }, "workers health server listening");
});

setInterval(() => {
  logger.info("heartbeat");
}, 30_000);
