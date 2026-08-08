import { readyForPickupResponse } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { UserRole } from "../security/jwt.js";

// retail_order:update is also granted to `customer` (04-roles §3: cancelling
// their OWN order before 'preparing' — a different action entirely) and
// orders.mark_ready_for_pickup takes only an order id, no actor/ownership
// check at all. Found sweeping every admin route file for the same defect
// class 0078/adminFleet.ts's fixes closed: without this, any signed-in
// customer could mark ANY order (not just their own) ready_for_pickup.
const ADMIN_ROLES: readonly UserRole[] = ["admin", "super_admin"];

// Pulled-forward AC-05 stand-in (SPEC-GAP, see db/migrations/0035 and
// packages/contracts/src/dl-delivery.ts): the real warehouse fulfillment
// console (pick list, "pick complete" action) is AC-05, S18. Without SOME
// caller of orders.mark_ready_for_pickup, DL-01's auto-assign dispatch
// (this session, S10) has no way to ever receive a real order — this is the
// minimum needed to make the roadmap's own S10 Out clause ("staged order
// auto-assigns") true end-to-end, same precedent orders.ts's own
// verify-bank-transfer stand-in already set for AC-08. `retail_order` is the
// closest existing authz.ts MATRIX resource (admin: read,update) — not a
// perfect semantic match (this is a fulfillment action, not an order-field
// edit), same caveat verify-bank-transfer's own comment already flags for
// its reuse of "payment".
export function registerAdminOrderRoutes(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/orders/:id/ready-for-pickup",
    { preHandler: requirePermission("update", "retail_order") },
    async (request, reply) => {
      const actor = request.ctx.actor;
      if (!actor) throw new ApiError("INVALID_CREDENTIALS");
      if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");
      try {
        await withServiceRoleTransaction(async (client) => {
          await client.query("select orders.mark_ready_for_pickup($1)", [request.params.id]);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(readyForPickupResponse.parse({ status: "ready_for_pickup" }));
    }
  );
}
