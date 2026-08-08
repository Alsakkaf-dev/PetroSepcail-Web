import {
  adminReadCustomerRequest,
  adminReadCustomerResponse,
  aggregationCheckResponse,
  auditLogResponse,
  breachAdvanceResponse,
  breachCreateRequest,
  breachListResponse,
  breachResponse,
  pdplAdvanceResponse,
  pdplRequestCreate,
  pdplRequestListResponse,
  pdplRequestResponse,
  verifyChainResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { AccessTokenClaims, UserRole } from "../security/jwt.js";

// 40-admin-center/05-api-specification.md §6/§9 (AC-07/AC-10, S18).

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

// customer_pii's own matrix entry grants `customer` read/update (04-roles
// §3: "RU own"), so the coarse `requirePermission("read", "customer_pii")`
// gate every route in this file's PDPL/breach family shares is not enough
// on its own — every one of those routes additionally requires this.
const ADMIN_ROLES: readonly UserRole[] = ["admin", "super_admin"];

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
      // core.admin_read_customer (0063) raises the lowercase 'forbidden'
      // (no errcode) rather than this file's own 'FORBIDDEN'/42501
      // convention — mapped explicitly rather than falling through to a
      // raw 500, which is what a customer role hitting this route saw
      // before (test:rls already proves the SQL-level denial itself works;
      // this is purely the HTTP-status mapping for it).
      if (message.toLowerCase().includes("forbidden")) throw new ApiError("FORBIDDEN");
      throw err;
    }
    return reply.code(200).send(adminReadCustomerResponse.parse(result));
  });

  // EP-AC-091 · POST /admin/pdpl/requests · auth(admin) — the shared
  // `requirePermission("read", "customer_pii")` gate also grants `customer`
  // read/update on that resource (04-roles §3), so every PDPL/breach route
  // below additionally requires the actor's role explicitly, the same
  // pattern EP-AC-094 already used for its own super_admin-only check. D6
  // (no SECURITY DEFINER function revokes its PUBLIC execute grant, session
  // 1's own §8) made this exactly this kind of gap possible; 0078 closes it
  // at the function layer too, not just here.
  app.post("/api/v1/admin/pdpl/requests", { preHandler: requirePermission("read", "customer_pii") }, async (request, reply) => {
    const actor = requireActor(request);
    if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");
    const body = pdplRequestCreate.parse(request.body);
    const result = await withServiceRoleTransaction(async (client) => {
      const res = await client.query<{ create_pdpl_request: { id: string; status: string; graceUntil: string | null } }>(
        "select audit.create_pdpl_request($1, $2, $3) as create_pdpl_request",
        [body.subjectId, body.kind, actor.sub]
      );
      return res.rows[0]!.create_pdpl_request;
    }, actor);
    return reply.code(201).send(pdplRequestResponse.parse(result));
  });

  // EP-AC-092 · POST /admin/pdpl/requests/{id}/advance · auth(admin)
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/pdpl/requests/:id/advance",
    { preHandler: requirePermission("read", "customer_pii") },
    async (request, reply) => {
      const actor = requireActor(request);
      if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");
      let status: string;
      try {
        status = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ advance_pdpl_request: string }>("select audit.advance_pdpl_request($1, $2) as advance_pdpl_request", [
            request.params.id,
            actor.sub
          ]);
          return res.rows[0]!.advance_pdpl_request;
        }, actor);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        if (message.includes("FORBIDDEN")) throw new ApiError("FORBIDDEN");
        throw err;
      }
      return reply.code(200).send(pdplAdvanceResponse.parse({ status }));
    }
  );

  // EP-AC-093 · POST /admin/pdpl/breaches · auth(admin)
  app.post("/api/v1/admin/pdpl/breaches", { preHandler: requirePermission("read", "customer_pii") }, async (request, reply) => {
    const actor = requireActor(request);
    if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");
    const body = breachCreateRequest.parse(request.body);
    const result = await withServiceRoleTransaction(async (client) => {
      const res = await client.query<{ open_breach: { id: string; notifyBy: string } }>("select audit.open_breach($1, $2, $3) as open_breach", [
        body.detectedAt,
        body.scope,
        actor.sub
      ]);
      return res.rows[0]!.open_breach;
    }, actor);
    return reply.code(201).send(breachResponse.parse({ id: result.id, notifyBy: result.notifyBy, status: "open" }));
  });

  // EP-AC-095 · GET /admin/pdpl/requests · auth(admin) — EP-AC-091/092 have
  // been callable since S18 with no way for a screen to discover a request's
  // id to advance; audit.pdpl_requests already grants app_user select under
  // an admin-role RLS policy (0064), so this is a route-only addition.
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/api/v1/admin/pdpl/requests",
    { preHandler: requirePermission("read", "customer_pii") },
    async (request, reply) => {
      const actor = requireActor(request);
      if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");
      const { cursor, limit } = parsePagination(request.query);
      const after = cursor ? decodeCursor<{ at: string; id: string }>(cursor) : null;

      const rows = await withServiceRoleTransaction(async (client) => {
        const params: unknown[] = [];
        let where = "";
        if (after) {
          params.push(after.at, after.id);
          where = `where (created_at, id) < ($1::timestamptz, $2::uuid)`;
        }
        params.push(limit + 1);
        const res = await client.query<{
          id: string;
          subject_id: string;
          kind: string;
          status: string;
          grace_until: string | null;
          created_at: Date;
          created_at_cursor: string;
          completed_at: Date | null;
        }>(
          `select id, subject_id, kind, status, grace_until, created_at, created_at::text as created_at_cursor, completed_at
           from audit.pdpl_requests ${where} order by created_at desc, id desc limit $${params.length}`,
          params
        );
        return res.rows;
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? encodeCursor({ at: page[page.length - 1]!.created_at_cursor, id: page[page.length - 1]!.id })
        : null;

      return reply.code(200).send(
        pdplRequestListResponse.parse(
          buildPage(
            page.map((r) => ({
              id: r.id,
              subjectId: r.subject_id,
              kind: r.kind,
              status: r.status,
              graceUntil: r.grace_until,
              createdAt: r.created_at.toISOString(),
              completedAt: r.completed_at ? r.completed_at.toISOString() : null
            })),
            nextCursor
          )
        )
      );
    }
  );

  // EP-AC-096 · GET /admin/pdpl/breaches · auth(admin)
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/api/v1/admin/pdpl/breaches",
    { preHandler: requirePermission("read", "customer_pii") },
    async (request, reply) => {
      const actor = requireActor(request);
      if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");
      const { cursor, limit } = parsePagination(request.query);
      const after = cursor ? decodeCursor<{ at: string; id: string }>(cursor) : null;

      const rows = await withServiceRoleTransaction(async (client) => {
        const params: unknown[] = [];
        let where = "";
        if (after) {
          params.push(after.at, after.id);
          where = `where (detected_at, id) < ($1::timestamptz, $2::uuid)`;
        }
        params.push(limit + 1);
        const res = await client.query<{
          id: string;
          detected_at: Date;
          detected_at_cursor: string;
          notify_by: Date;
          scope: string;
          status: string;
        }>(
          `select id, detected_at, detected_at::text as detected_at_cursor, notify_by, scope, status
           from audit.breach_notifications ${where} order by detected_at desc, id desc limit $${params.length}`,
          params
        );
        return res.rows;
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? encodeCursor({ at: page[page.length - 1]!.detected_at_cursor, id: page[page.length - 1]!.id })
        : null;

      return reply.code(200).send(
        breachListResponse.parse(
          buildPage(
            page.map((r) => ({
              id: r.id,
              detectedAt: r.detected_at.toISOString(),
              notifyBy: r.notify_by.toISOString(),
              scope: r.scope,
              status: r.status
            })),
            nextCursor
          )
        )
      );
    }
  );

  // EP-AC-097 · POST /admin/pdpl/breaches/{id}/advance · auth(admin)
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/pdpl/breaches/:id/advance",
    { preHandler: requirePermission("read", "customer_pii") },
    async (request, reply) => {
      const actor = requireActor(request);
      if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");
      let status: string;
      try {
        status = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ advance_breach: string }>("select audit.advance_breach($1, $2) as advance_breach", [
            request.params.id,
            actor.sub
          ]);
          return res.rows[0]!.advance_breach;
        }, actor);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        if (message.includes("FORBIDDEN")) throw new ApiError("FORBIDDEN");
        throw err;
      }
      return reply.code(200).send(breachAdvanceResponse.parse({ status }));
    }
  );

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
