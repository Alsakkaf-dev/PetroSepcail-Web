import Fastify, { type FastifyInstance } from "fastify";
import { buildLoggerOptions } from "@petrospecial/observability";
import { metrics } from "./metrics.js";

// UBL 2.1 XML / QR TLV / crypto-stamp clearance logic lands in S15 (ADR-11).
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: buildLoggerOptions("zatca-sim") });

  // TC-PC10-004: same latency/error-rate instrumentation as services/api.
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? request.url;
    const labels = { method: request.method, route, status_code: String(reply.statusCode) };
    metrics.httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    if (reply.statusCode >= 500) metrics.httpErrorsTotal.inc(labels);
  });

  app.get("/health", async () => ({ status: "ok", service: "zatca-sim" }));
  app.get("/metrics", async (_request, reply) => {
    reply.header("content-type", metrics.registry.contentType);
    return reply.send(await metrics.registry.metrics());
  });

  return app;
}
