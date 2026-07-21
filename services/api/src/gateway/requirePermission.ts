import type { FastifyReply, FastifyRequest } from "fastify";
import { authorize, type Action, type Resource } from "../authz.js";
import { ApiError } from "../errors.js";

// FR-PC02-003: "A single server-side authorize(actor, action, resource) ...
// every endpoint calls it. Denials return 403 FORBIDDEN with no data
// leakage." A Fastify preHandler so future (S07+) business-resource routes
// gate on it declaratively: `{ preHandler: requirePermission("read", "catalog") }`.
export function requirePermission(action: Action, resource: Resource) {
  return async function preHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS", { reason: "missing bearer token" });
    if (!authorize({ role: actor.role }, action, resource)) throw new ApiError("FORBIDDEN");
  };
}
