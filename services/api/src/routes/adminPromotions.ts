import { campaignConfigRequest, couponConfigRequest, eligibilityRuleRequest, promotionConfigResponse } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { AccessTokenClaims } from "../security/jwt.js";

// 40-admin-center/05-api-specification.md §3 (AC-04, S17), updated S19/S20
// once LE-02/04 actually existed to forward to. Coupons (EP-AC-030) and
// eligibility rules (EP-AC-032) now write real loyalty tables via
// loyalty.admin_create_coupon/create_eligibility_rule (0071) — "writes no
// loyalty table" (08-implementation-guide.md §4) means AC never writes
// loyalty.* directly with a bare INSERT, not that it can't call LE's own
// SECURITY DEFINER functions, the same relationship every other AC-writes-
// another-schema case in this codebase already has (NFR-AC-006). Campaigns
// (EP-AC-031) stay a thin audited "queued" stub: attaching coupons to a
// scheduled window is a secondary action out of this pass's scope, honestly
// reported rather than half-built.

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

async function auditPromotionSubmission(actorId: string, actorRole: string, action: string, payload: unknown): Promise<void> {
  await withServiceRoleTransaction(async (client) => {
    await client.query(
      `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
       values ($1, $2, $3, 'promotions.config', null, $4)`,
      [actorId, actorRole, action, JSON.stringify(payload)]
    );
  });
}

export function registerAdminPromotionRoutes(app: FastifyInstance): void {
  // EP-AC-030 · POST/PATCH /admin/promotions/coupons · auth(admin)
  for (const method of ["post", "patch"] as const) {
    app[method](
      "/api/v1/admin/promotions/coupons",
      { preHandler: requirePermission("update", "coupon") },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = couponConfigRequest.parse(request.body);
        const constraints = (body.constraints ?? {}) as Record<string, unknown>;
        await withServiceRoleTransaction(async (client) => {
          await client.query("select loyalty.admin_create_coupon($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
            body.code,
            body.type,
            body.value,
            typeof constraints.minOrder === "number" ? constraints.minOrder : 0,
            constraints.firstOrderOnly === true,
            typeof constraints.perUserLimit === "number" ? constraints.perUserLimit : null,
            typeof constraints.usageCap === "number" ? constraints.usageCap : null,
            typeof constraints.validUntil === "string" ? constraints.validUntil : null,
            actor.sub
          ]);
        });
        return reply.code(202).send(promotionConfigResponse.parse({ status: "queued", note: "coupon saved; live immediately for eligible customers" }));
      }
    );
  }

  // EP-AC-031 · POST/PATCH /admin/promotions/campaigns · auth(admin)
  for (const method of ["post", "patch"] as const) {
    app[method](
      "/api/v1/admin/promotions/campaigns",
      { preHandler: requirePermission("update", "coupon") },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = campaignConfigRequest.parse(request.body);
        await auditPromotionSubmission(actor.sub, actor.role, "promotions.campaign.submitted", body);
        return reply
          .code(202)
          .send(promotionConfigResponse.parse({ status: "queued", note: "campaign+coupon attachment admin flow not yet built" }));
      }
    );
  }

  // EP-AC-032 · POST /admin/promotions/rules · auth(admin)
  app.post("/api/v1/admin/promotions/rules", { preHandler: requirePermission("update", "coupon") }, async (request, reply) => {
    const actor = requireActor(request);
    const body = eligibilityRuleRequest.parse(request.body);
    if (typeof body.rule !== "object" || body.rule === null) throw new ApiError("VALIDATION_ERROR", { field: "rule", reason: "must be a JSON object" });
    try {
      await withServiceRoleTransaction(async (client) => {
        await client.query("select loyalty.create_eligibility_rule($1, $2::jsonb, $3)", ["admin rule", JSON.stringify(body.rule), actor.sub]);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("RULE_INVALID")) throw new ApiError("VALIDATION_ERROR", { field: "rule", reason: "invalid rule tree" });
      throw err;
    }
    return reply.code(202).send(promotionConfigResponse.parse({ status: "queued", note: "rule saved" }));
  });
}
