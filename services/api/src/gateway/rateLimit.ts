import rateLimit from "@fastify/rate-limit";
import { errorEnvelope } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import type { UserRole } from "../security/jwt.js";

// FR-PC04-003 (D-09, [BUSINESS-CONFIRM]): per-role limits, 1-minute window,
// 429 + Retry-After over limit. `hook: "preHandler"` guarantees this runs
// after requestContext's onRequest hook has resolved request.ctx.actor,
// regardless of plugin registration order (Fastify's fixed lifecycle:
// onRequest -> preParsing -> preValidation -> preHandler).
const ROLE_LIMITS: Record<"anon" | UserRole, number> = {
  anon: 60,
  customer: 120,
  supplier: 120,
  driver: 300, // "for pings" in the spec's phrasing — the general per-role cap here
  admin: 240,
  super_admin: 240
};

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    hook: "preHandler",
    timeWindow: "1 minute",
    max: (request) => ROLE_LIMITS[request.ctx?.actor?.role ?? "anon"],
    keyGenerator: (request) => request.ctx?.actor?.sub ?? request.ip,
    errorResponseBuilder: () =>
      errorEnvelope.parse({
        error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." }
      })
  });
}
