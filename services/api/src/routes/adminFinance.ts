import {
  adminCustodyResponse,
  custodyRemittanceVerifyRequest,
  custodyRemittanceVerifyResponse,
  invoiceWriteOffRequest,
  invoiceWriteOffResponse,
  receivablesResponse,
  verificationQueueResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { AccessTokenClaims } from "../security/jwt.js";

// 40-admin-center/05-api-specification.md §5 (AC-08, S18). Exposure/aging =
// SP-03's own credit.v_exposure/v_receivables_aging verbatim (NFR-AC-007);
// custody read here (EP-AC-075) never carries a debt figure in the same
// object (D-14 rule f).

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

export function registerAdminFinanceRoutes(app: FastifyInstance): void {
  // EP-AC-070 · GET /admin/finance/receivables · auth(admin)
  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/api/v1/admin/finance/receivables",
    { preHandler: requirePermission("read", "credit_limit") },
    async (request, reply) => {
      const { cursor, limit } = parsePagination(request.query);
      const after = cursor ? decodeCursor<{ id: string }>(cursor) : null;

      const rows = await withServiceRoleTransaction(async (client) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (after) {
          params.push(after.id);
          conditions.push(`s.id > $${params.length}`);
        }
        params.push(limit + 1);
        const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
        const res = await client.query<{
          supplier_id: string;
          exposure: string;
          credit_limit: string | null;
          b_0_30: string | null;
          b_31_60: string | null;
          b_61_90: string | null;
          b_90_plus: string | null;
        }>(
          `select s.id as supplier_id, v.exposure, v.credit_limit, a.b_0_30, a.b_31_60, a.b_61_90, a.b_90_plus
           from credit.suppliers s
           left join credit.v_exposure v on v.supplier_id = s.id
           left join credit.v_receivables_aging a on a.supplier_id = s.id
           ${where} order by s.id limit $${params.length}`,
          params
        );
        return res.rows;
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? encodeCursor({ id: page[page.length - 1]!.supplier_id }) : null;

      return reply.code(200).send(
        receivablesResponse.parse(
          buildPage(
            page.map((r) => ({
              supplierId: r.supplier_id,
              exposure: money(Number(r.exposure ?? 0)),
              creditLimit: money(Number(r.credit_limit ?? 0)),
              aging: {
                b0_30: money(Number(r.b_0_30 ?? 0)),
                b31_60: money(Number(r.b_31_60 ?? 0)),
                b61_90: money(Number(r.b_61_90 ?? 0)),
                b90plus: money(Number(r.b_90_plus ?? 0))
              }
            })),
            nextCursor
          )
        )
      );
    }
  );

  // EP-AC-071 · GET /admin/finance/verification-queue · auth(admin)
  app.get(
    "/api/v1/admin/finance/verification-queue",
    { preHandler: requirePermission("read", "payment") },
    async (_request, reply) => {
      const items = await withServiceRoleTransaction(async (client) => {
        const proofs = await client.query<{ id: string; amount: string; supplier_id: string; submitted_at: Date }>(
          "select id, amount, supplier_id, submitted_at from credit.payment_proofs where status = 'pending' order by submitted_at"
        );
        const custody = await client.query<{ id: string; amount: string; driver_id: string; collected_at: Date }>(
          "select id, amount, driver_id, collected_at from delivery.driver_cash_custody where status = 'held' order by collected_at"
        );
        return [
          ...proofs.rows.map((p) => ({
            kind: "bank_transfer" as const,
            refId: p.id,
            claimedAmount: money(Number(p.amount)),
            submittedBy: p.supplier_id,
            submittedAt: p.submitted_at.toISOString()
          })),
          ...custody.rows.map((c) => ({
            kind: "custody_remittance" as const,
            refId: c.id,
            claimedAmount: money(Number(c.amount)),
            submittedBy: c.driver_id,
            submittedAt: c.collected_at.toISOString()
          }))
        ];
      });
      return reply.code(200).send(verificationQueueResponse.parse({ items }));
    }
  );

  // EP-AC-072 · POST /admin/finance/bank-transfer/{proofId}/verify · auth(admin)
  // — thin admin-facing alias over the same credit.apply_verified_payment
  // path routes/supplierInvoicing.ts's own pulled-forward stand-in already
  // wired at EP-SP-040's own verify-payment. Kept as a separate route (not a
  // redirect) so this session's authz gate (AC finance permission) is
  // independent of the supplier-facing one.
  app.post<{ Params: { proofId: string } }>(
    "/api/v1/admin/finance/bank-transfer/:proofId/verify",
    { preHandler: requirePermission("create", "payment") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = request.body as { matchedBankRef?: string };
      try {
        await withServiceRoleTransaction(async (client) => {
          await client.query("select credit.apply_verified_payment($1, $2, $3)", [request.params.proofId, actor.sub, body.matchedBankRef ?? null]);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("INVOICE_NOT_OPEN")) throw new ApiError("INVOICE_NOT_OPEN");
        throw err;
      }
      return reply.code(200).send({ status: "verified" });
    }
  );

  // EP-AC-073 · POST /admin/finance/custody/{custodyRef}/verify-remittance ·
  // auth(admin) — tries supplier custody first (custody_ref), then driver
  // custody (id) — the path param is the same generic "custodyRef" either
  // side of D-14 rule f's holder split can use.
  app.post<{ Params: { custodyRef: string } }>(
    "/api/v1/admin/finance/custody/:custodyRef/verify-remittance",
    { preHandler: requirePermission("create", "payment") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = custodyRemittanceVerifyRequest.parse(request.body);
      try {
        await withServiceRoleTransaction(async (client) => {
          const supplierRow = await client.query("select 1 from credit.custody_ledger where custody_ref = $1", [request.params.custodyRef]);
          if (supplierRow.rowCount! > 0) {
            await client.query("select credit.admin_verify_supplier_remittance($1, $2, $3)", [request.params.custodyRef, body.amount, actor.sub]);
          } else {
            await client.query("select delivery.admin_verify_driver_remittance($1, $2, $3)", [request.params.custodyRef, body.amount, actor.sub]);
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("CUSTODY_MISMATCH")) throw new ApiError("CUSTODY_MISMATCH");
        throw err;
      }
      return reply.code(200).send(custodyRemittanceVerifyResponse.parse({ status: "remitted" }));
    }
  );

  // EP-AC-074 · POST /admin/finance/invoices/{id}/write-off · auth(admin)
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/finance/invoices/:id/write-off",
    { preHandler: requirePermission("update", "invoice") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = invoiceWriteOffRequest.parse(request.body);
      try {
        await withServiceRoleTransaction(async (client) => {
          await client.query("select credit.write_off_invoice($1, $2, $3)", [request.params.id, actor.sub, body.reason]);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        throw err;
      }
      return reply.code(200).send(invoiceWriteOffResponse.parse({ status: "written_off" }));
    }
  );

  // EP-AC-075 · GET /admin/finance/custody · auth(admin) — Custody Funds
  // oversight ONLY, both holder kinds, no debt figure present (NFR-AC-007).
  app.get("/api/v1/admin/finance/custody", { preHandler: requirePermission("read", "payment") }, async (_request, reply) => {
    const holders = await withServiceRoleTransaction(async (client) => {
      const driverRows = await client.query<{ driver_id: string; held: string | null; remitted: string | null }>(
        `select driver_id, sum(amount) filter (where status = 'held') as held, sum(amount) filter (where status = 'remitted') as remitted
         from delivery.driver_cash_custody group by driver_id`
      );
      const supplierRows = await client.query<{ supplier_id: string; held: string | null; remitted: string | null }>(
        `select supplier_id, sum(amount) filter (where status = 'held') as held, sum(amount) filter (where status = 'remitted') as remitted
         from credit.custody_ledger group by supplier_id`
      );
      return [
        ...driverRows.rows.map((r) => ({ holderKind: "driver" as const, holderId: r.driver_id, heldTotal: money(Number(r.held ?? 0)), remittedTotal: money(Number(r.remitted ?? 0)) })),
        ...supplierRows.rows.map((r) => ({ holderKind: "supplier" as const, holderId: r.supplier_id, heldTotal: money(Number(r.held ?? 0)), remittedTotal: money(Number(r.remitted ?? 0)) }))
      ];
    });
    return reply.code(200).send(adminCustodyResponse.parse({ holders }));
  });
}
