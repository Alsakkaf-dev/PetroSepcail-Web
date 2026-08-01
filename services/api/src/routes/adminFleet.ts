import {
  fleetAlertsResponse,
  fleetKpisResponse,
  fleetMapTokenResponse,
  reassignTaskRequest,
  reassignTaskResponse,
  setAuditCadenceRequest,
  setAuditCadenceResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { AccessTokenClaims } from "../security/jwt.js";

// 40-admin-center/05-api-specification.md §5 (AC-09, S18).

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

export function registerAdminFleetRoutes(app: FastifyInstance): void {
  // EP-AC-080 · GET /admin/fleet/map-token · auth(admin) — same
  // bearer-token-as-channel-token convention every other stream-token
  // endpoint in this codebase already uses (storefrontFull.ts/
  // supplierTracking.ts).
  app.get("/api/v1/admin/fleet/map-token", { preHandler: requirePermission("read", "driver_location") }, async (request, reply) => {
    const actor = requireActor(request);
    const auth = request.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    const expiresIn = actor.exp ? Math.max(0, actor.exp - Math.floor(Date.now() / 1000)) : 0;
    return reply.code(200).send(fleetMapTokenResponse.parse({ channel: "admin:fleet", token, expiresIn }));
  });

  // EP-AC-081 · GET /admin/fleet/kpis · auth(admin) — honest nulls for what
  // delivery.v_driver_kpis doesn't compute (onTime/avgTimeToDeliver/
  // reconAccuracy/custodyOnTime), same precedent as
  // adminAnalytics.ts's fulfillment endpoint.
  app.get("/api/v1/admin/fleet/kpis", { preHandler: requirePermission("read", "driver_location") }, async (_request, reply) => {
    const rows = await withServiceRoleTransaction(async (client) => {
      const res = await client.query<{ driver_id: string; delivered_ratio: string; failed_count: string }>(
        "select driver_id, delivered_ratio, failed_count from delivery.v_driver_kpis"
      );
      return res.rows;
    });
    return reply.code(200).send(
      fleetKpisResponse.parse({
        rows: rows.map((r) => ({
          driverId: r.driver_id,
          onTimePct: null,
          avgTimeToDeliverMin: null,
          failedPct: Number(r.failed_count) > 0 ? Number(r.failed_count) : 0,
          reconAccuracyPct: null,
          custodyOnTimePct: null
        }))
      })
    );
  });

  // EP-AC-082 · PUT /admin/fleet/audit-cadence · auth(super_admin)
  app.put("/api/v1/admin/fleet/audit-cadence", { preHandler: requirePermission("read", "driver_location") }, async (request, reply) => {
    const actor = requireActor(request);
    if (actor.role !== "super_admin") throw new ApiError("FORBIDDEN");
    const body = setAuditCadenceRequest.parse(request.body);
    await withServiceRoleTransaction(async (client) => {
      await client.query("select delivery.admin_set_audit_interval($1, $2, $3)", [body.entityKind, body.entityId, body.intervalDays]);
    });
    return reply.code(200).send(setAuditCadenceResponse.parse({ status: "updated" }));
  });

  // EP-AC-083 · GET /admin/fleet/alerts · auth(admin)
  app.get("/api/v1/admin/fleet/alerts", { preHandler: requirePermission("read", "driver_location") }, async (_request, reply) => {
    const items = await withServiceRoleTransaction(async (client) => {
      const res = await client.query<{ kind: string; ref: string; severity: string }>("select * from delivery.admin_fleet_alerts()");
      return res.rows;
    });
    return reply.code(200).send(fleetAlertsResponse.parse({ items }));
  });

  // EP-AC-083 · POST /admin/fleet/tasks/{id}/reassign · auth(admin)
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/fleet/tasks/:id/reassign",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = reassignTaskRequest.parse(request.body);
      try {
        await withServiceRoleTransaction(async (client) => {
          await client.query("select delivery.admin_reassign_task($1, $2, $3, $4)", [request.params.id, body.driverId, actor.sub, body.reason]);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        throw err;
      }
      return reply.code(200).send(reassignTaskResponse.parse({ status: "reassigned" }));
    }
  );
}
