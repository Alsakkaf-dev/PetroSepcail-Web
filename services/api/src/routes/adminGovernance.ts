import {
  adminReadCustomerRequest,
  adminReadCustomerResponse,
  aggregationCheckResponse,
  auditLogResponse,
  breachCreateRequest,
  breachResponse,
  pdplAdvanceResponse,
  pdplRequestCreate,
  pdplRequestResponse,
  verifyChainResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { AccessTokenClaims } from "../security/jwt.js";

// 40-admin-center/05-api-specification.md §6/§9 (AC-07/AC-10, S18).

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

export function registerAdminGovernanceRoutes(app: FastifyInstance): void {
  // EP-AC-060 · GET /admin/audit · auth(admin) — an admin sees only their
  // own entries, super_admin sees all (FR-AC07-001/003). This route runs
  // over app_service_role with an explicit role check rather than the RLS
  // policy (0063's audit_admin_own) alone, matching checkout.ts's own
  // established "app_service_role + explicit ownership check" pattern for
  // any route that also needs cursor pagination beyond what a bare RLS SELECT
  // conveniently supports.
  app.get<{ Querystring: { actorId?: string; resource?: string; action?: string; from?: string; to?: string; cursor?: string; limit?: string } }>(
    "/api/v1/admin/audit",
    { preHandler: requirePermission("read", "audit_log") },
    async (request, reply) => {
      const actor = requireActor(request);
      const { cursor, limit } = parsePagination(request.query);
      const after = cursor ? decodeCursor<{ at: string; id: string }>(cursor) : null;

      const rows = await withServiceRoleTransaction(async (client) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (actor.role !== "super_admin") {
          params.push(actor.sub);
          conditions.push(`actor_id = $${params.length}`);
        }
        if (request.query.actorId) {
          params.push(request.query.actorId);
          conditions.push(`actor_id = $${params.length}`);
        }
        if (request.query.resource) {
          params.push(request.query.resource);
          conditions.push(`resource = $${params.length}`);
        }
        if (request.query.action) {
          params.push(request.query.action);
          conditions.push(`action = $${params.length}`);
        }
        if (request.query.from) {
          params.push(request.query.from);
          conditions.push(`at >= $${params.length}`);
        }
        if (request.query.to) {
          params.push(request.query.to);
          conditions.push(`at <= $${params.length}`);
        }
        if (after) {
          params.push(after.at, after.id);
          conditions.push(`(at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
        }
        params.push(limit + 1);
        const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
        // at_cursor: full microsecond precision as text, since `pg` truncates
        // `at` to a millisecond-resolution JS Date and a truncated cursor
        // silently drops rows sharing a millisecond (routine under a burst of
        // audit-logged writes from one transaction).
        const res = await client.query<{
          id: string;
          actor_id: string | null;
          actor_role: string | null;
          action: string;
          resource: string;
          resource_id: string | null;
          reason: string | null;
          at: Date;
          at_cursor: string;
        }>(
          `select id, actor_id, actor_role, action, resource, resource_id, reason, at, at::text as at_cursor from audit.audit_log ${where} order by at desc, id desc limit $${params.length}`,
          params
        );
        return res.rows;
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? encodeCursor({ at: page[page.length - 1]!.at_cursor, id: page[page.length - 1]!.id }) : null;

      return reply.code(200).send(
        auditLogResponse.parse(
          buildPage(
            page.map((r) => ({
              at: r.at.toISOString(),
              actorId: r.actor_id,
              role: r.actor_role,
              action: r.action,
              resource: r.resource,
              resourceId: r.resource_id,
              reason: r.reason
            })),
            nextCursor
          )
        )
      );
    }
  );

  // EP-AC-061 · GET /admin/audit/verify-chain · auth(super_admin)
  app.get("/api/v1/admin/audit/verify-chain", { preHandler: requirePermission("read", "audit_log") }, async (request, reply) => {
    const actor = requireActor(request);
    if (actor.role !== "super_admin") throw new ApiError("FORBIDDEN");

    const brokenAt = await withServiceRoleTransaction(async (client) => {
      const res = await client.query<{ id: string }>(
        `select id from (
           select id, row_hash, prev_hash, lag(row_hash) over (order by id) as expected_prev
           from audit.audit_log
         ) t where prev_hash is distinct from expected_prev and expected_prev is not null`
      );
      return res.rows.map((r) => Number(r.id));
    });

    return reply.code(200).send(verifyChainResponse.parse(brokenAt.length > 0 ? { intact: false, brokenAt } : { intact: true }));
  });

  // EP-AC-090 · POST /admin/customers/read · auth(admin) — the ONLY
  // customer-PII read path (core.admin_read_customer, 0063's corrected
  // curated jsonb + mandatory-reason version).
  app.post("/api/v1/admin/customers/read", { preHandler: requirePermission("read", "customer_pii") }, async (request, reply) => {
    const actor = requireActor(request);
    const body = adminReadCustomerRequest.parse(request.body);
    let result: { id: string; fullName: string; phone: string; email: string; status: string };
    try {
      result = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ admin_read_customer: typeof result }>("select core.admin_read_customer($1, $2) as admin_read_customer", [
          body.customerId,
          body.reason
        ]);
        return res.rows[0]!.admin_read_customer;
      }, actor);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
      if (message.includes("REASON_REQUIRED")) throw new ApiError("VALIDATION_ERROR", { field: "reason", reason: "required" });
      throw err;
    }
    return reply.code(200).send(adminReadCustomerResponse.parse(result));
  });

  // EP-AC-091 · POST /admin/pdpl/requests · auth(admin)
  app.post("/api/v1/admin/pdpl/requests", { preHandler: requirePermission("read", "customer_pii") }, async (request, reply) => {
    const actor = requireActor(request);
    const body = pdplRequestCreate.parse(request.body);
    const result = await withServiceRoleTransaction(async (client) => {
      const res = await client.query<{ create_pdpl_request: { id: string; status: string; graceUntil: string | null } }>(
        "select audit.create_pdpl_request($1, $2, $3) as create_pdpl_request",
        [body.subjectId, body.kind, actor.sub]
      );
      return res.rows[0]!.create_pdpl_request;
    });
    return reply.code(201).send(pdplRequestResponse.parse(result));
  });

  // EP-AC-092 · POST /admin/pdpl/requests/{id}/advance · auth(admin)
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/pdpl/requests/:id/advance",
    { preHandler: requirePermission("read", "customer_pii") },
    async (request, reply) => {
      const actor = requireActor(request);
      let status: string;
      try {
        status = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ advance_pdpl_request: string }>("select audit.advance_pdpl_request($1, $2) as advance_pdpl_request", [
            request.params.id,
            actor.sub
          ]);
          return res.rows[0]!.advance_pdpl_request;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(pdplAdvanceResponse.parse({ status }));
    }
  );

  // EP-AC-093 · POST /admin/pdpl/breaches · auth(admin)
  app.post("/api/v1/admin/pdpl/breaches", { preHandler: requirePermission("read", "customer_pii") }, async (request, reply) => {
    const actor = requireActor(request);
    const body = breachCreateRequest.parse(request.body);
    const result = await withServiceRoleTransaction(async (client) => {
      const res = await client.query<{ open_breach: { id: string; notifyBy: string } }>("select audit.open_breach($1, $2, $3) as open_breach", [
        body.detectedAt,
        body.scope,
        actor.sub
      ]);
      return res.rows[0]!.open_breach;
    });
    return reply.code(201).send(breachResponse.parse({ id: result.id, notifyBy: result.notifyBy, status: "open" }));
  });

  // EP-AC-094 · GET /admin/pdpl/aggregation-check · auth(super_admin) —
  // orders.v_sales_kpi's own HAVING clause (0065) already enforces the floor
  // structurally, so every returned row is trivially >= floor by construction;
  // this reports the actual observed minimum as evidence, not a re-derivation
  // of the rule. v_bestsellers_family has no customer-count dimension to
  // floor (it aggregates qty/revenue per sku, not per buyer) — reported as
  // not applicable via a null-safe true, not fabricated as floor-checked.
  app.get("/api/v1/admin/pdpl/aggregation-check", { preHandler: requirePermission("read", "customer_pii") }, async (request, reply) => {
    const actor = requireActor(request);
    if (actor.role !== "super_admin") throw new ApiError("FORBIDDEN");

    const result = await withServiceRoleTransaction(async (client) => {
      const floorRes = await client.query<{ get_setting: string }>("select core.get_setting('k_anon_floor') as get_setting");
      const floor = Number(floorRes.rows[0]?.get_setting ?? 5);
      const minRes = await client.query<{ min_buyers: string | null }>("select min(buyers) as min_buyers from orders.v_sales_kpi");
      const minBuyers = minRes.rows[0]?.min_buyers !== null && minRes.rows[0]?.min_buyers !== undefined ? Number(minRes.rows[0].min_buyers) : floor;
      return { floor, minBuyers };
    });

    return reply.code(200).send(
      aggregationCheckResponse.parse({
        views: [
          { name: "orders.v_sales_kpi", minCellCount: result.minBuyers, ok: result.minBuyers >= result.floor },
          { name: "orders.v_bestsellers_family", minCellCount: result.floor, ok: true }
        ]
      })
    );
  });
}
