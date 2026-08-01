import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import { errorEnvelope } from "@petrospecial/contracts";
import { buildLoggerOptions } from "@petrospecial/observability";
import { ApiError, type ErrorCode } from "./errors.js";
import { checkReadiness } from "./gateway/readiness.js";
import { registerRateLimit } from "./gateway/rateLimit.js";
import { registerRequestContext } from "./gateway/requestContext.js";
import { metrics } from "./metrics.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerAddressRoutes } from "./routes/addresses.js";
import { registerAdminAnalyticsRoutes } from "./routes/adminAnalytics.js";
import { registerAdminCatalogRoutes } from "./routes/adminCatalog.js";
import { registerAdminCreditRoutes } from "./routes/adminCredit.js";
import { registerAdminFinanceRoutes } from "./routes/adminFinance.js";
import { registerAdminFleetRoutes } from "./routes/adminFleet.js";
import { registerAdminGovernanceRoutes } from "./routes/adminGovernance.js";
import { registerAdminInterventionRoutes } from "./routes/adminInterventions.js";
import { registerAdminPromotionRoutes } from "./routes/adminPromotions.js";
import { registerAdminOrderRoutes } from "./routes/adminOrders.js";
import { registerAdminUserRoutes } from "./routes/adminUsers.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCartRoutes } from "./routes/cart.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerCheckoutRoutes } from "./routes/checkout.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerDriverDeliveryRoutes } from "./routes/driverDelivery.js";
import { registerDriverShiftRoutes } from "./routes/driverShift.js";
import { registerOrderRoutes } from "./routes/orders.js";
import { registerI18nRoutes } from "./routes/i18n.js";
import { registerLoyaltyRoutes } from "./routes/loyalty.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerStorefrontFullRoutes } from "./routes/storefrontFull.js";
import { registerSupplierRoutes } from "./routes/supplier.js";
import { registerSupplierInvoicingRoutes } from "./routes/supplierInvoicing.js";
import { registerSupplierStatementRoutes } from "./routes/supplierStatement.js";
import { registerSupplierTrackingRoutes } from "./routes/supplierTracking.js";

// TC-PC10-004: reasons the login handler (routes/auth.ts) can reject a
// credential-verification attempt. Counted centrally here, in the one place
// every ApiError thrown from any route already flows through, rather than
// threading a metrics import down into the transaction/repository layers.
const LOGIN_FAILURE_CODES: ReadonlySet<ErrorCode> = new Set([
  "INVALID_CREDENTIALS",
  "ACCOUNT_LOCKED",
  "EMAIL_UNVERIFIED",
  "MFA_REQUIRED",
  "MFA_INVALID"
]);

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: buildLoggerOptions("api") });

  // store/admin/driver run as separate Vercel projects on separate origins
  // from this one (D-15 pivot — no Caddy same-origin proxy anymore), so
  // their browser-side fetches are genuine cross-origin requests. Auth here
  // is a bearer token attached manually per-request (no cookies), so there
  // is no CSRF/credential-leak concern in reflecting any origin — this is
  // the standard open-CORS posture for a public bearer-token JSON API.
  await app.register(cors, { origin: true });

  // 03-sdd.md §10 request lifecycle order: request context (request_id,
  // actor, locale) resolves onRequest, before rate limiting (preHandler)
  // and before any route handler.
  registerRequestContext(app);
  await registerRateLimit(app);

  // TC-PC10-004: HTTP latency + error-rate signals, one observation per
  // completed response. `routeOptions.url` is the registered pattern (e.g.
  // "/api/v1/media/:objectKey/url"), not the raw path, so labels stay
  // low-cardinality even once path-param routes exist.
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? request.url;
    const labels = { method: request.method, route, status_code: String(reply.statusCode) };
    metrics.httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    if (reply.statusCode >= 500) metrics.httpErrorsTotal.inc(labels);
  });

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
  app.get("/metrics", async (_request, reply) => {
    reply.header("content-type", metrics.registry.contentType);
    return reply.send(await metrics.registry.metrics());
  });

  registerAuthRoutes(app);
  registerMeRoutes(app);
  registerI18nRoutes(app);
  registerConfigRoutes(app);
  registerNotificationRoutes(app);
  registerMediaRoutes(app);
  registerCatalogRoutes(app);
  registerAdminCatalogRoutes(app);
  registerAddressRoutes(app);
  registerCartRoutes(app);
  registerCheckoutRoutes(app);
  registerOrderRoutes(app);
  registerAccountRoutes(app);
  registerAdminUserRoutes(app);
  registerAdminOrderRoutes(app);
  registerAdminAnalyticsRoutes(app);
  registerAdminCreditRoutes(app);
  registerAdminInterventionRoutes(app);
  registerAdminGovernanceRoutes(app);
  registerAdminFinanceRoutes(app);
  registerAdminFleetRoutes(app);
  registerAdminPromotionRoutes(app);
  registerLoyaltyRoutes(app);
  registerDriverDeliveryRoutes(app);
  registerDriverShiftRoutes(app);
  registerStorefrontFullRoutes(app);
  registerSupplierRoutes(app);
  registerSupplierInvoicingRoutes(app);
  registerSupplierStatementRoutes(app);
  registerSupplierTrackingRoutes(app);

  // D-09 error envelope {error:{code,message,details}} — the single
  // translation point from thrown errors to the wire format every EP-PC
  // endpoint promises.
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ApiError) {
      if (request.routeOptions.url === "/api/v1/auth/login" && LOGIN_FAILURE_CODES.has(err.code)) {
        metrics.authFailuresTotal.inc({ reason: err.code });
      }
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

// Vercel Serverless (S09 Docker->managed migration): the previous approach
// here (an unconditional top-level `.listen()` under `if (process.env.VERCEL)`)
// was based on a wrong theory -- Vercel does NOT start the server itself via
// a detected `.listen()` call. Its Node.js runtime invokes the compiled
// module's *default export* directly, once per request, and requires that
// export to be a `(req, res) => ...` handler (or a raw `http.Server`) --
// confirmed directly by its own runtime error: "Invalid export found ...
// The default export must be a function or server." Fix: export exactly
// that. The Fastify instance is built + made ready once and memoized
// (`readyApp`) so warm serverless invocations reuse it instead of rebuilding
// on every request; each request is then re-emitted onto Fastify's
// underlying raw `http.Server` (`app.server`), which is the documented way
// to drive a Fastify app from a handler Vercel/Node itself invokes rather
// than one that owns its own `.listen()`. Local dev (`src/index.ts`) and the
// test suite never import this default export -- they only ever call
// `buildServer()` directly -- so none of this touches non-Vercel runs.
let readyApp: Promise<FastifyInstance> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!readyApp) {
    readyApp = buildServer().then(async (app) => {
      await app.ready();
      return app;
    });
  }
  const app = await readyApp;
  app.server.emit("request", req, res);
}
