import {
  acknowledgeDualControlResponse,
  adminSupplierListResponse,
  creditOverrideRequest,
  creditOverrideResponse,
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
import type { AccessTokenClaims } from "../security/jwt.js";

// 40-admin-center/05-api-specification.md §2 (AC-03, S17).

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

export function registerAdminCreditRoutes(app: FastifyInstance): void {
  // EP-AC-020 · GET /admin/suppliers · auth(admin)
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/api/v1/admin/suppliers",
    { preHandler: requirePermission("read", "supplier_master") },
    async (request, reply) => {
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
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("FORBIDDEN")) throw new ApiError("FORBIDDEN");
        throw err;
      }
      void actor;
      return reply
        .code(200)
        .send(setCreditLimitResponse.parse({ status: result.status, ...(result.newLimit !== undefined ? { newLimit: money(result.newLimit) } : {}) }));
    }
  );

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
      const body = setSupplierTierRequest.parse(request.body);
      await withServiceRoleTransaction(async (client) => {
        await client.query("select credit.admin_set_supplier_tier($1, $2, $3)", [request.params.id, body.tier, body.reason]);
      });
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
