import { statementPdfResponse, statementResponse, supplierDashboardResponse } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withRlsTransaction, withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import type { AccessTokenClaims } from "../security/jwt.js";

// 30-supplier-portal/05-api-specification.md §6 (SP-06, S16).

function requireSupplier(request: { ctx: { actor: AccessTokenClaims | null } }): { actor: AccessTokenClaims; supplierId: string } {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  if (actor.role !== "supplier" || !actor.supplier_id) throw new ApiError("FORBIDDEN");
  return { actor, supplierId: actor.supplier_id };
}

export function registerSupplierStatementRoutes(app: FastifyInstance): void {
  // EP-SP-050 · GET /supplier/statement · auth(supplier) · ?periodStart=&periodEnd=
  app.get<{ Querystring: { periodStart: string; periodEnd: string } }>("/api/v1/supplier/statement", async (request, reply) => {
    const { supplierId } = requireSupplier(request);
    const { periodStart, periodEnd } = request.query;
    if (!periodStart || !periodEnd) throw new ApiError("VALIDATION_ERROR", { field: "periodStart/periodEnd", reason: "required" });

    const statement = await withServiceRoleTransaction(async (client) => {
      await client.query("select credit.generate_statement($1, $2, $3)", [supplierId, periodStart, periodEnd]);
      const res = await client.query<{
        opening_balance: string;
        invoices_total: string;
        payments_total: string;
        credit_notes_total: string;
        closing_balance: string;
        aging: { b0_30: number; b31_60: number; b61_90: number; b90plus: number };
      }>(
        `select opening_balance, invoices_total, payments_total, credit_notes_total, closing_balance, aging
         from credit.statements where supplier_id = $1 and period_start = $2 and period_end = $3`,
        [supplierId, periodStart, periodEnd]
      );
      return res.rows[0]!;
    });

    // FR-SP06-004: line-level detail for the period, alongside the totals
    // credit.generate_statement already rolled up.
    const lines = await withRlsTransaction(request.ctx.actor, async (client) => {
      const invoices = await client.query<{ id: string; total: string; issued_at: Date }>(
        "select id, total, issued_at from credit.invoices where supplier_id = $1 and issued_at::date between $2 and $3",
        [supplierId, periodStart, periodEnd]
      );
      const payments = await client.query<{ id: string; amount: string; verified_at: Date }>(
        "select id, amount, verified_at from credit.payments_received where supplier_id = $1 and verified_at::date between $2 and $3",
        [supplierId, periodStart, periodEnd]
      );
      const notes = await client.query<{ id: string; amount: string; created_at: Date }>(
        "select id, amount, created_at from credit.credit_notes where supplier_id = $1 and created_at::date between $2 and $3",
        [supplierId, periodStart, periodEnd]
      );
      return [
        ...invoices.rows.map((r) => ({ kind: "invoice" as const, refId: r.id, amount: money(Number(r.total)), at: r.issued_at.toISOString() })),
        ...payments.rows.map((r) => ({ kind: "payment" as const, refId: r.id, amount: money(Number(r.amount)), at: r.verified_at.toISOString() })),
        ...notes.rows.map((r) => ({ kind: "credit_note" as const, refId: r.id, amount: money(Number(r.amount)), at: r.created_at.toISOString() }))
      ].sort((a, b) => a.at.localeCompare(b.at));
    });

    return reply.code(200).send(
      statementResponse.parse({
        opening: money(Number(statement.opening_balance)),
        invoicesTotal: money(Number(statement.invoices_total)),
        paymentsTotal: money(Number(statement.payments_total)),
        creditNotesTotal: money(Number(statement.credit_notes_total)),
        closing: money(Number(statement.closing_balance)),
        aging: {
          b0_30: money(Number(statement.aging.b0_30)),
          b31_60: money(Number(statement.aging.b31_60)),
          b61_90: money(Number(statement.aging.b61_90)),
          b90plus: money(Number(statement.aging.b90plus))
        },
        lines
      })
    );
  });

  // EP-SP-051 · GET /supplier/statement/pdf · auth(supplier) — SPEC-GAP,
  // same same-origin-JSON fallback as invoicePdfResponse.
  app.get<{ Querystring: { periodStart: string; periodEnd: string } }>("/api/v1/supplier/statement/pdf", async (request, reply) => {
    requireSupplier(request);
    const { periodStart, periodEnd } = request.query;
    return reply.code(200).send(
      statementPdfResponse.parse({ pdfUrl: `/api/v1/supplier/statement?periodStart=${periodStart}&periodEnd=${periodEnd}`, expiresIn: 3600 })
    );
  });

  // EP-SP-052 · GET /supplier/dashboard · auth(supplier) — three SEPARATE
  // objects (D-14 rule f / NFR-SP-002), backs SCR-SP06-001's two-panel UI.
  app.get("/api/v1/supplier/dashboard", async (request, reply) => {
    const { actor, supplierId } = requireSupplier(request);

    const [debt, custody] = await Promise.all([
      withRlsTransaction(actor, async (client) => {
        const exposureRes = await client.query<{ exposure: string; credit_limit: string | null }>(
          "select exposure, credit_limit from credit.v_exposure where supplier_id = $1",
          [supplierId]
        );
        const agingRes = await client.query<{ b_0_30: string | null; b_31_60: string | null; b_61_90: string | null; b_90_plus: string | null }>(
          "select b_0_30, b_31_60, b_61_90, b_90_plus from credit.v_receivables_aging where supplier_id = $1",
          [supplierId]
        );
        const openRes = await client.query<{ count: string }>(
          "select count(*) from credit.invoices where supplier_id = $1 and status in ('issued', 'partially_paid', 'overdue')",
          [supplierId]
        );
        const row = exposureRes.rows[0] ?? { exposure: "0", credit_limit: "0" };
        const aging = agingRes.rows[0] ?? { b_0_30: "0", b_31_60: "0", b_61_90: "0", b_90_plus: "0" };
        return {
          exposure: Number(row.exposure),
          creditLimit: Number(row.credit_limit ?? 0),
          aging: {
            b0_30: money(Number(aging.b_0_30 ?? 0)),
            b31_60: money(Number(aging.b_31_60 ?? 0)),
            b61_90: money(Number(aging.b_61_90 ?? 0)),
            b90plus: money(Number(aging.b_90_plus ?? 0))
          },
          openInvoices: Number(openRes.rows[0]?.count ?? 0)
        };
      }),
      withRlsTransaction(actor, async (client) => {
        const res = await client.query<{ status: string; amount: string }>(
          "select status, amount from credit.custody_ledger where supplier_id = $1",
          [supplierId]
        );
        const heldTotal = res.rows.filter((r) => r.status === "held").reduce((sum, r) => sum + Number(r.amount), 0);
        const remittedTotal = res.rows.filter((r) => r.status === "remitted").reduce((sum, r) => sum + Number(r.amount), 0);
        return { heldTotal: money(heldTotal), remittedTotal: money(remittedTotal) };
      })
    ]);

    return reply.code(200).send(
      supplierDashboardResponse.parse({
        debt: {
          exposure: money(debt.exposure),
          creditLimit: money(debt.creditLimit),
          headroom: money(Math.max(debt.creditLimit - debt.exposure, 0)),
          aging: debt.aging,
          openInvoices: debt.openInvoices
        },
        custodyCash: custody,
        // SPEC-GAP: delivery.v_supplier_pickup_custody (EP-SP-043's own data
        // source) is owned by DL-08, not yet built — flagged in this
        // session's S15 handover, not silently stubbed. Zero, not fabricated.
        goodsCustody: { count: 0 }
      })
    );
  });
}
