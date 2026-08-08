import {
  acknowledgeDualControlResponse,
  adminSupplierListResponse,
  creditOverrideRequest,
  creditOverrideResponse,
  dualControlListResponse,
  setCreditLimitRequest,
  setCreditLimitResponse,
  setSupplierTierRequest,
  setSupplierTierResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { AccessTokenClaims, UserRole } from "../security/jwt.js";

// 40-admin-center/05-api-specification.md §2 (AC-03, S17).

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

// supplier_master:read/update and credit_limit:read are also granted to
// `supplier` (04-roles §3: reading/updating their OWN master data, reading
// their OWN credit limit) — a legitimately narrower case these admin-console
// routes were never meant to share. Found sweeping every admin route file
// for the same defect class 0078/adminFleet.ts's fixes closed; confirmed by
// direct read of services/api/src/authz.ts, not assumed.
const ADMIN_ROLES: readonly UserRole[] = ["admin", "super_admin"];

export function registerAdminCreditRoutes(app: FastifyInstance): void {
  // EP-AC-020 · GET /admin/suppliers · auth(admin)
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/api/v1/admin/suppliers",
    { preHandler: requirePermission("read", "supplier_master") },
    async (request, reply) => {
      const actor = requireActor(request);
      if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");
      const { cursor, limit } = parsePagination(request.query);
      const after = cursor ? decodeCursor<{ businessNameEn: string; id: string }>(cursor) : null;

      const rows = await withServiceRoleTransaction(async (client) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (after) {
          params.push(after.businessNameEn, after.id);
          conditions.push(`(s.business_name_en, s.id) > ($${params.length - 1}, $${params.length}::uuid)`);
        }
        params.push(limit + 1);
        const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
        const res = await client.query<{
          id: string;
          business_name_ar: string;
          business_name_en: string;
          tier: string;
          credit_limit: string | null;
          exposure: string;
        }>(
          `select s.id, s.business_name_ar, s.business_name_en, s.tier, v.credit_limit, v.exposure
           from credit.suppliers s left join credit.v_exposure v on v.supplier_id = s.id
           ${where} order by s.business_name_en, s.id limit $${params.length}`,
          params
        );
        return res.rows;
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? encodeCursor({ businessNameEn: page[page.length - 1]!.business_name_en, id: page[page.length - 1]!.id })
        : null;

      return reply.code(200).send(
        adminSupplierListResponse.parse(
          buildPage(
            page.map((r) => {
              const limitAmount = Number(r.credit_limit ?? 0);
              const exposure = Number(r.exposure ?? 0);
              return {
                supplierId: r.id,
                businessNameAr: r.business_name_ar,
                businessNameEn: r.business_name_en,
                tier: r.tier,
                creditLimit: money(limitAmount),
                exposure: money(exposure),
                headroom: money(Math.max(limitAmount - exposure, 0))
              };
            }),
            nextCursor
          )
        )
      );
    }
  );

  // EP-AC-021 · PUT /admin/suppliers/{id}/credit-limit · auth(admin)
  app.put<{ Params: { id: string } }>(
    "/api/v1/admin/suppliers/:id/credit-limit",
    { preHandler: requirePermission("update", "credit_limit") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = setCreditLimitRequest.parse(request.body);
      let result: { status: string; newLimit?: number };
      try {
        result = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ admin_set_credit_limit: { status: string; newLimit?: number } }>(
            "select credit.admin_set_credit_limit($1, $2, $3) as admin_set_credit_limit",
            [request.params.id, body.newLimit, body.reason]
          );
          return res.rows[0]!.admin_set_credit_limit;
        }, actor);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("FORBIDDEN")) throw new ApiError("FORBIDDEN");
        throw err;
      }
      return reply
        .code(200)
        .send(setCreditLimitResponse.parse({ status: result.status, ...(result.newLimit !== undefined ? { newLimit: money(result.newLimit) } : {}) }));
    }
  );

  // GET /admin/dual-control · auth(admin) — real gap found building the
  // credit/ZATCA critical-journey e2e test: setCreditLimitRequest's own
  // pending_dual_control branch (EP-AC-021) had no read path at all, so a
  // different super_admin had no way to ever discover a pending approval's
  // id to acknowledge it. Same read permission as GET /admin/suppliers
  // (any admin can see what's pending); acknowledging itself stays
  // super_admin-only, enforced below exactly as it already was.
  app.get("/api/v1/admin/dual-control", { preHandler: requirePermission("read", "credit_limit") }, async (request, reply) => {
    const actor = requireActor(request);
    if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");
    const items = await withServiceRoleTransaction(async (client) => {
      const res = await client.query<{ id: string; payload: { supplier_id: string; new_limit: number }; requested_by: string; created_at: Date }>(
        `select id, payload, requested_by, created_at from audit.dual_control_approvals
         where request_kind = 'credit_limit_over_threshold' and status = 'pending'
         order by created_at`
      );
      return res.rows.map((r) => ({
        approvalId: r.id,
        requestKind: "credit_limit_over_threshold" as const,
        supplierId: r.payload.supplier_id,
        newLimit: money(Number(r.payload.new_limit)),
        requestedBy: r.requested_by,
        createdAt: r.created_at.toISOString()
      }));
    });
    return reply.code(200).send(dualControlListResponse.parse({ items }));
  });

  // EP-AC-022 · POST /admin/dual-control/{approvalId}/acknowledge · auth(super_admin)
  app.post<{ Params: { approvalId: string } }>(
    "/api/v1/admin/dual-control/:approvalId/acknowledge",
    { preHandler: requirePermission("update", "credit_limit") },
    async (request, reply) => {
      const actor = requireActor(request);
      if (actor.role !== "super_admin") throw new ApiError("FORBIDDEN");
      const updated = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ requested_by: string }>(
          "select requested_by from audit.dual_control_approvals where id = $1 and status = 'pending'",
          [request.params.approvalId]
        );
        const row = res.rows[0];
        if (!row) throw new ApiError("NOT_FOUND");
        if (row.requested_by === actor.sub) throw new ApiError("FORBIDDEN", { reason: "a different super_admin must acknowledge" });
        await client.query(
          "update audit.dual_control_approvals set status = 'approved', acknowledged_by = $2, acknowledged_at = now() where id = $1",
          [request.params.approvalId, actor.sub]
        );
        return true;
      });
      void updated;
      return reply.code(200).send(acknowledgeDualControlResponse.parse({ status: "approved" }));
    }
  );

  // EP-AC-023 · PUT /admin/suppliers/{id}/tier · auth(admin)
  app.put<{ Params: { id: string } }>(
    "/api/v1/admin/suppliers/:id/tier",
    { preHandler: requirePermission("update", "supplier_master") },
    async (request, reply) => {
      const actor = requireActor(request);
      // credit.admin_set_supplier_tier already checks this internally
      // (0065), so a supplier was never actually able to reach it — this is
      // defense-in-depth plus a clean 403 instead of an unmapped exception,
      // matching every other route this sweep fixed.
      if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");
      const body = setSupplierTierRequest.parse(request.body);
      await withServiceRoleTransaction(async (client) => {
        await client.query("select credit.admin_set_supplier_tier($1, $2, $3)", [request.params.id, body.tier, body.reason]);
      }, actor);
      return reply.code(200).send(setSupplierTierResponse.parse({ status: "updated" }));
    }
  );

  // EP-AC-024 · POST /admin/suppliers/{id}/credit-override · auth(super_admin)
  // Break-glass over a credit-blocked order — re-runs the wholesale
  // placement path is out of scope here (the order was already blocked
  // before creation, nothing to override on a row that was never written);
  // this records the override decision + reason as an audited exception so
  // an operator can re-attempt placement through the normal EP-SP-003 path
  // once logged. FR-AC03-004 doesn't specify a different mechanism.
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/suppliers/:id/credit-override",
    { preHandler: requirePermission("update", "credit_limit") },
    async (request, reply) => {
      const actor = requireActor(request);
      if (actor.role !== "super_admin") throw new ApiError("FORBIDDEN");
      const body = creditOverrideRequest.parse(request.body);
      await withServiceRoleTransaction(async (client) => {
        await client.query(
          `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after, reason)
           values ($1, $2, 'credit.override', 'orders.orders', $3, $4, $5)`,
          [actor.sub, actor.role, body.orderId, JSON.stringify({ supplierId: request.params.id }), body.reason]
        );
      });
      return reply.code(200).send(creditOverrideResponse.parse({ status: "overridden" }));
    }
  );
}
