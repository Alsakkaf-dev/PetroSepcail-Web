import {
  addressEditRequest,
  addressEditResponse,
  forceCancelRequest,
  forceCancelResponse,
  interventionListResponse,
  returnDecisionRequest,
  returnDecisionResponse,
  reviewModerateRequest,
  reviewModerateResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { AccessTokenClaims } from "../security/jwt.js";

// 40-admin-center/05-api-specification.md §4 (AC-05, S18).

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

function mapDbError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
  if (message.includes("ORDER_NOT_CANCELLABLE")) throw new ApiError("ORDER_NOT_CANCELLABLE");
  if (message.includes("INVALID_REASON_CODE")) throw new ApiError("INVALID_REASON_CODE");
  if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
  throw err as Error;
}

export function registerAdminInterventionRoutes(app: FastifyInstance): void {
  // EP-AC-040 · GET /admin/interventions · auth(admin) — every intervention
  // this session's functions record lands in audit.audit_log with a
  // resource-specific action name (order.force_cancel, order.address_edit,
  // return.decision, review.moderate); this reads that slice directly rather
  // than duplicating a second interventions-table write path (audit.interventions,
  // 0064, is available for a future session's own case-tracking UI but isn't
  // populated by these functions — the audit log IS the queue for now).
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/api/v1/admin/interventions",
    { preHandler: requirePermission("read", "audit_log") },
    async (request, reply) => {
      const { cursor, limit } = parsePagination(request.query);
      const after = cursor ? decodeCursor<{ at: string; id: string }>(cursor) : null;

      const rows = await withServiceRoleTransaction(async (client) => {
        const conditions = [
          "action in ('order.force_cancel', 'order.address_edit', 'return.decision', 'review.moderate')"
        ];
        const params: unknown[] = [];
        if (after) {
          params.push(after.at, after.id);
          conditions.push(`(at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
        }
        params.push(limit + 1);
        // at_cursor: full microsecond precision as text, since `pg` truncates
        // `at` to a millisecond-resolution JS Date and a truncated cursor
        // silently drops rows sharing a millisecond.
        const res = await client.query<{
          id: string;
          action: string;
          resource: string;
          resource_id: string | null;
          reason: string | null;
          at: Date;
          at_cursor: string;
        }>(
          `select id, action, resource, resource_id, reason, at, at::text as at_cursor from audit.audit_log
           where ${conditions.join(" and ")} order by at desc, id desc limit $${params.length}`,
          params
        );
        return res.rows;
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? encodeCursor({ at: page[page.length - 1]!.at_cursor, id: page[page.length - 1]!.id }) : null;

      const kindByAction: Record<string, string> = {
        "order.force_cancel": "force_cancel",
        "order.address_edit": "address_edit",
        "return.decision": "return_decision",
        "review.moderate": "review_moderation"
      };

      return reply.code(200).send(
        interventionListResponse.parse(
          buildPage(
            page.map((r) => ({
              id: String(r.id),
              kind: kindByAction[r.action] ?? "force_cancel",
              orderId: r.resource === "orders.orders" ? r.resource_id : null,
              reasonCode: r.reason ?? "",
              outcome: "resolved" as const,
              createdAt: r.at.toISOString()
            })),
            nextCursor
          )
        )
      );
    }
  );

  // EP-AC-041 · POST /admin/orders/{id}/cancel · auth(admin)
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/orders/:id/cancel",
    { preHandler: requirePermission("update", "retail_order") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = forceCancelRequest.parse(request.body);
      try {
        await withServiceRoleTransaction(async (client) => {
          await client.query("select orders.admin_force_cancel($1, $2, $3, $4)", [request.params.id, actor.sub, body.reasonCode, body.note ?? null]);
        });
      } catch (err) {
        mapDbError(err);
      }
      return reply.code(200).send(forceCancelResponse.parse({ status: "cancelled" }));
    }
  );

  // EP-AC-042 · POST /admin/orders/{id}/address · auth(admin)
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/orders/:id/address",
    { preHandler: requirePermission("update", "retail_order") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = addressEditRequest.parse(request.body);
      try {
        await withServiceRoleTransaction(async (client) => {
          await client.query("select orders.admin_edit_address($1, $2, $3::jsonb, $4)", [
            request.params.id,
            actor.sub,
            JSON.stringify(body.addressSnapshot),
            body.reasonCode
          ]);
        });
      } catch (err) {
        mapDbError(err);
      }
      return reply.code(200).send(addressEditResponse.parse({ status: "updated" }));
    }
  );

  // EP-AC-043 · POST /admin/returns/{id}/decision · auth(admin)
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/returns/:id/decision",
    { preHandler: requirePermission("update", "return") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = returnDecisionRequest.parse(request.body);
      let status: string;
      try {
        status = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ admin_decide_return: string }>("select orders.admin_decide_return($1, $2, $3, $4) as admin_decide_return", [
            request.params.id,
            actor.sub,
            body.decision,
            body.reasonCode
          ]);
          return res.rows[0]!.admin_decide_return;
        });
      } catch (err) {
        mapDbError(err);
      }
      return reply.code(200).send(returnDecisionResponse.parse({ status: status === "approved" ? "approved" : "rejected" }));
    }
  );

  // EP-AC-044 · POST /admin/reviews/{id}/moderate · auth(admin)
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/reviews/:id/moderate",
    { preHandler: requirePermission("delete", "review") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = reviewModerateRequest.parse(request.body);
      try {
        await withServiceRoleTransaction(async (client) => {
          await client.query("select orders.admin_moderate_review($1, $2, $3, $4)", [request.params.id, actor.sub, body.action, body.reasonCode]);
        });
      } catch (err) {
        mapDbError(err);
      }
      return reply.code(200).send(reviewModerateResponse.parse({ status: "moderated" }));
    }
  );
}
