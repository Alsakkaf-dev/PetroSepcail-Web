import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { errorEnvelope } from "@petrospecial/contracts";
import { ApiError } from "./errors.js";
import { checkReadiness } from "./gateway/readiness.js";
import { registerRateLimit } from "./gateway/rateLimit.js";
import { registerRequestContext } from "./gateway/requestContext.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerI18nRoutes } from "./routes/i18n.js";
import { registerMeRoutes } from "./routes/me.js";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // 03-sdd.md §10 request lifecycle order: request context (request_id,
  // actor, locale) resolves onRequest, before rate limiting (preHandler)
  // and before any route handler.
  registerRequestContext(app);
  await registerRateLimit(app);

  // EP-PC-060/061 (FR-PC04-005). Kept as bare /health too (not just
  // /api/v1/health) — that's what docker-compose's healthcheck already
  // polls for every service (S00); no reason to break it for this one.
  app.get("/health", async () => ({ status: "ok", service: "api" }));
  app.get("/api/v1/health", async () => ({ status: "ok" }));
  app.get("/api/v1/ready", async (_request, reply) => {
    const result = await checkReadiness();
    const ready = result.db && result.storage && result.realtime;
    return reply.code(ready ? 200 : 503).send(result);
  });

  registerAuthRoutes(app);
  registerMeRoutes(app);
  registerI18nRoutes(app);
  registerConfigRoutes(app);

  // D-09 error envelope {error:{code,message,details}} — the single
  // translation point from thrown errors to the wire format every EP-PC
  // endpoint promises.
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send(err.toEnvelope());
    }
    if (err instanceof ZodError) {
      return reply.code(422).send(
        errorEnvelope.parse({
          error: { code: "VALIDATION_ERROR", message: "Validation failed.", details: err.issues }
        })
      );
    }
    app.log.error(err);
    return reply.code(500).send(new ApiError("INTERNAL").toEnvelope());
  });

  return app;
}
