import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { verifyAccessToken, type AccessTokenClaims } from "../security/jwt.js";

// FR-PC04-002 / 03-sdd.md §10 request lifecycle: "Caddy -> api: attach
// X-Request-Id; resolve actor from JWT (verify RS256 signature, exp, claim
// shape); resolve locale; authorize() before handler; ...". This hook
// resolves {requestId, actor, locale} for every request; actor is null for
// anonymous/invalid-token requests (public endpoints must stay reachable) —
// route-level guards (requireAuth.ts, requirePermission below) are what
// actually reject when auth is required.
export interface RequestContext {
  requestId: string;
  actor: AccessTokenClaims | null;
  locale: "ar" | "en";
}

declare module "fastify" {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}

function resolveLocale(actor: AccessTokenClaims | null, acceptLanguage: string | undefined): "ar" | "en" {
  if (actor?.locale) return actor.locale;
  if (acceptLanguage?.toLowerCase().startsWith("en")) return "en";
  return "ar"; // NFR-PC-007: Arabic is the default locale
}

export function registerRequestContext(app: FastifyInstance): void {
  // Fastify's decorateRequest requires a default value matching the
  // declared type; the hook below always populates the real value before
  // any handler runs, so this placeholder is never actually read as-is.
  app.decorateRequest("ctx", null as unknown as RequestContext);

  app.addHook("onRequest", async (request, reply) => {
    const requestId = (request.headers["x-request-id"] as string | undefined) || randomUUID();
    reply.header("X-Request-Id", requestId);

    let actor: AccessTokenClaims | null = null;
    const auth = request.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        actor = await verifyAccessToken(auth.slice("Bearer ".length));
      } catch {
        actor = null; // missing/expired/invalid -> anonymous; guards enforce required auth
      }
    }

    request.ctx = {
      requestId,
      actor,
      locale: resolveLocale(actor, request.headers["accept-language"])
    };
  });
}
