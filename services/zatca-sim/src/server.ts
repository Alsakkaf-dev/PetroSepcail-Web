import Fastify, { type FastifyInstance } from "fastify";

// UBL 2.1 XML / QR TLV / crypto-stamp clearance logic lands in S15 (ADR-11).
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok", service: "zatca-sim" }));

  return app;
}
