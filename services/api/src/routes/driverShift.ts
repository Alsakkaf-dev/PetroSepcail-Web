import {
  availabilityRequest,
  closeShiftResponse,
  reconcileRequest,
  reconcileResponse,
  remitCustodyResponse,
  shiftResponse,
  shiftStartRequest,
  shiftStartResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withRlsTransaction, withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { AccessTokenClaims } from "../security/jwt.js";

function requireDriver(request: { ctx: { actor: AccessTokenClaims | null } }): { actor: AccessTokenClaims; driverId: string } {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  if (actor.role !== "driver" || !actor.driver_id) throw new ApiError("FORBIDDEN");
  return { actor, driverId: actor.driver_id };
}

// DL-07 (S11) — Task DL-SHIFT-1/2/3. "driver_profile"/"delivery_task" are
// the closest existing authz.ts MATRIX resources; shifts themselves have no
// dedicated resource entry (same reuse precedent as adminOrders.ts's
// ready-for-pickup stand-in), so the coarse gate here is `delivery_task`
// (driver: read/update) since a shift only ever exists to serve tasks.
export function registerDriverShiftRoutes(app: FastifyInstance): void {
  // EP-DL-001 · POST /driver/shifts/start · auth(driver)
  app.post(
    "/api/v1/driver/shifts/start",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const body = shiftStartRequest.parse(request.body);
      let shiftId: string;
      try {
        shiftId = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ start_shift: string }>("select delivery.start_shift($1, $2, $3) as start_shift", [
            driverId,
            body.vanId,
            JSON.stringify(body.load)
          ]);
          return res.rows[0]!.start_shift;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("STOCK_INSUFFICIENT")) throw new ApiError("STOCK_INSUFFICIENT");
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT"); // already has an open shift
        throw err;
      }
      return reply.code(201).send(shiftStartResponse.parse({ shiftId, openingStock: body.load }));
    }
  );

  // EP-DL-002 · GET /driver/shift · auth(driver)
  app.get(
    "/api/v1/driver/shift",
    { preHandler: requirePermission("read", "delivery_task") },
    async (request, reply) => {
      const { actor, driverId } = requireDriver(request);
      const result = await withRlsTransaction(actor, async (client) => {
        const shiftRes = await client.query<{ id: string; van_id: string; status: string; available: boolean }>(
          "select id, van_id, status, available from delivery.shifts where driver_id = $1 and status <> 'closed'",
          [driverId]
        );
        const shift = shiftRes.rows[0];
        if (!shift) return null;

        const stockRes = await client.query<{ pack_size_id: string; qty: number }>(
          `select vs.pack_size_id, vs.qty from catalog.van_stock vs
           join catalog.stock_locations l on l.id = vs.location_id
           where l.van_id = $1`,
          [shift.van_id]
        );
        const custodyRes = await client.query<{ held: string }>(
          "select coalesce(sum(amount), 0) as held from delivery.driver_cash_custody where driver_id = $1 and status = 'held'",
          [driverId]
        );
        return { shift, vanStock: stockRes.rows, custodyHeld: custodyRes.rows[0]!.held };
      });

      if (!result) return reply.code(200).send(shiftResponse.parse(null));
      return reply.code(200).send(
        shiftResponse.parse({
          shiftId: result.shift.id,
          vanId: result.shift.van_id,
          status: result.shift.status,
          available: result.shift.available,
          vanStock: result.vanStock.map((r) => ({ packSizeId: r.pack_size_id, qty: r.qty })),
          custodyHeld: money(Number(result.custodyHeld))
        })
      );
    }
  );

  // EP-DL-003 · PATCH /driver/availability · auth(driver)
  app.patch(
    "/api/v1/driver/availability",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { actor, driverId } = requireDriver(request);
      const body = availabilityRequest.parse(request.body);
      await withRlsTransaction(actor, async (client) => {
        const res = await client.query(
          "update delivery.shifts set available = $2 where driver_id = $1 and status = 'open'",
          [driverId, body.available]
        );
        if (res.rowCount === 0) throw new ApiError("SHIFT_REQUIRED");
      });
      return reply.code(200).send({});
    }
  );

  // EP-DL-004 · POST /driver/shifts/{id}/reconcile · auth(driver)
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/shifts/:id/reconcile",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const body = reconcileRequest.parse(request.body);
      let variance: unknown;
      try {
        variance = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ reconcile_shift: unknown }>(
            "select delivery.reconcile_shift($1, $2, $3) as reconcile_shift",
            [request.params.id, driverId, JSON.stringify(body.counted)]
          );
          return res.rows[0]!.reconcile_shift;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(reconcileResponse.parse({ variance }));
    }
  );

  // EP-DL-005 · POST /driver/shifts/{id}/remit-custody · auth(driver) —
  // admin-verified remittance (FR-DL07-006): p_verified_by is the admin who
  // physically received the cash. SPEC-GAP: the API spec doesn't name who
  // calls this or how an admin identity reaches a driver-scoped endpoint —
  // conservative reading (D-17): the driver initiates at shift-end (they're
  // physically handing over cash to whoever's on duty), so this session
  // records the driver's own actor as verified_by rather than inventing an
  // admin hand-off flow AC hasn't built yet (that's the real admin-side
  // cash-count console, out of scope here).
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/shifts/:id/remit-custody",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const remitted = await withServiceRoleTransaction(async (client) => {
        const held = await client.query<{ id: string; amount: string }>(
          "select id, amount from delivery.driver_cash_custody where driver_id = $1 and status = 'held'",
          [driverId]
        );
        let total = 0;
        for (const row of held.rows) {
          await client.query("select delivery.remit_cash_custody($1, $2)", [row.id, driverId]);
          total += Number(row.amount);
        }
        return { count: held.rows.length, total };
      });
      return reply.code(200).send(remitCustodyResponse.parse({ remitted: remitted.count, amount: money(remitted.total) }));
    }
  );

  // EP-DL-006 · POST /driver/shifts/{id}/close · auth(driver)
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/shifts/:id/close",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      try {
        await withServiceRoleTransaction(async (client) => {
          await client.query("select delivery.close_shift($1, $2)", [request.params.id, driverId]);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("AUDIT_VARIANCE")) throw new ApiError("AUDIT_VARIANCE");
        if (message.includes("CUSTODY_OPEN")) throw new ApiError("CUSTODY_OPEN");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(closeShiftResponse.parse({ status: "closed" }));
    }
  );
}
