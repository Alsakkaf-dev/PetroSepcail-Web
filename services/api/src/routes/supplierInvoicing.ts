import {
  custodyResponse,
  invoiceDetailResponse,
  invoiceListResponse,
  invoicePdfResponse,
  paymentListResponse,
  payProofRequest,
  payProofResponse,
  verifyPaymentRequest,
  verifyPaymentResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withRlsTransaction, withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { generateUblXml } from "../zatca/fatooraSim.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { AccessTokenClaims } from "../security/jwt.js";

// 30-supplier-portal/05-api-specification.md §4/5 (SP-04/SP-05, S15).
// EP-SP-020..020/001..012 (SP-01/02/03, S14) live in routes/supplier.ts;
// EP-SP-050+ (statements, SP-06) is S16.

function requireSupplier(request: { ctx: { actor: AccessTokenClaims | null } }): { actor: AccessTokenClaims; supplierId: string } {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  if (actor.role !== "supplier" || !actor.supplier_id) throw new ApiError("FORBIDDEN");
  return { actor, supplierId: actor.supplier_id };
}

interface InvoiceRow {
  id: string;
  order_id: string;
  status: string;
  total: string;
  open_balance: string;
  issued_at: Date;
  due_at: Date;
  zatca_uuid: string | null;
}

function toInvoiceListItem(r: InvoiceRow) {
  return {
    invoiceId: r.id,
    orderId: r.order_id,
    status: r.status,
    total: money(Number(r.total)),
    openBalance: money(Number(r.open_balance)),
    issuedAt: r.issued_at.toISOString(),
    dueAt: r.due_at.toISOString(),
    zatcaUuid: r.zatca_uuid
  };
}

export function registerSupplierInvoicingRoutes(app: FastifyInstance): void {
  // EP-SP-030 · GET /supplier/invoices · auth(supplier)
  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/api/v1/supplier/invoices", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const { cursor, limit } = parsePagination(request.query);
    const after = cursor ? decodeCursor<{ issuedAt: string; id: string }>(cursor) : null;

    const rows = await withRlsTransaction(actor, async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (after) {
        params.push(after.issuedAt, after.id);
        conditions.push(`(issued_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }
      params.push(limit + 1);
      const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
      // issued_at_cursor: full microsecond precision as text, since `pg`
      // truncates issued_at to a millisecond-resolution JS Date and a
      // truncated cursor silently drops rows sharing a millisecond.
      const res = await client.query<InvoiceRow & { issued_at_cursor: string }>(
        `select id, order_id, status, total, open_balance, issued_at, issued_at::text as issued_at_cursor, due_at, zatca_uuid
         from credit.invoices ${where} order by issued_at desc, id desc limit $${params.length}`,
        params
      );
      return res.rows;
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? encodeCursor({ issuedAt: page[page.length - 1]!.issued_at_cursor, id: page[page.length - 1]!.id })
      : null;

    return reply.code(200).send(invoiceListResponse.parse(buildPage(page.map(toInvoiceListItem), nextCursor)));
  });

  // EP-SP-031 · GET /supplier/invoices/{id} · auth(supplier)
  app.get<{ Params: { id: string } }>("/api/v1/supplier/invoices/:id", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const result = await withRlsTransaction(actor, async (client) => {
      const invoiceRes = await client.query<InvoiceRow & { qr_tlv: string | null; delivery_date: Date | null }>(
        "select id, order_id, status, total, open_balance, issued_at, due_at, zatca_uuid, qr_tlv, delivery_date from credit.invoices where id = $1",
        [request.params.id]
      );
      const invoice = invoiceRes.rows[0];
      if (!invoice) return null;
      const linesRes = await client.query<{ name_ar: string; name_en: string; qty: number; unit_price: string; vat_amount: string; line_total: string }>(
        "select name_ar, name_en, qty, unit_price, vat_amount, line_total from credit.invoice_lines where invoice_id = $1",
        [request.params.id]
      );
      return { invoice, lines: linesRes.rows };
    });
    if (!result) throw new ApiError("NOT_FOUND");
    return reply.code(200).send(
      invoiceDetailResponse.parse({
        invoice: toInvoiceListItem(result.invoice),
        lines: result.lines.map((l) => ({
          nameAr: l.name_ar,
          nameEn: l.name_en,
          qty: l.qty,
          unitPrice: money(Number(l.unit_price)),
          vatAmount: money(Number(l.vat_amount)),
          lineTotal: money(Number(l.line_total))
        })),
        qrTlv: result.invoice.qr_tlv,
        deliveryDate: result.invoice.delivery_date ? result.invoice.delivery_date.toISOString().slice(0, 10) : null
      })
    );
  });

  // EP-SP-032 · GET /supplier/invoices/{id}/pdf · auth(supplier) — SPEC-GAP,
  // see invoicePdfResponse's own comment (no PDF renderer/object storage yet).
  app.get<{ Params: { id: string } }>("/api/v1/supplier/invoices/:id/pdf", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const exists = await withRlsTransaction(actor, async (client) => {
      const res = await client.query("select 1 from credit.invoices where id = $1", [request.params.id]);
      return res.rowCount! > 0;
    });
    if (!exists) throw new ApiError("NOT_FOUND");
    return reply.code(200).send(invoicePdfResponse.parse({ pdfUrl: `/api/v1/supplier/invoices/${request.params.id}`, expiresIn: 3600 }));
  });

  // EP-SP-033 · GET /supplier/invoices/{id}/ubl · auth(supplier) — real XML,
  // regenerated on demand (deterministic given the same stored inputs; no
  // object storage wired to persist it, same SPEC-GAP as the PDF route).
  app.get<{ Params: { id: string } }>("/api/v1/supplier/invoices/:id/ubl", async (request, reply) => {
    const { actor, supplierId } = requireSupplier(request);
    const result = await withRlsTransaction(actor, async (client) => {
      const invoiceRes = await client.query<{
        total: string;
        vat_amount: string;
        issued_at: Date;
        zatca_uuid: string | null;
        qr_tlv: string | null;
      }>("select total, vat_amount, issued_at, zatca_uuid, qr_tlv from credit.invoices where id = $1", [request.params.id]);
      const invoice = invoiceRes.rows[0];
      if (!invoice) return null;
      const supplierRes = await client.query<{ business_name_ar: string; business_name_en: string }>(
        "select business_name_ar, business_name_en from credit.suppliers where id = $1",
        [supplierId]
      );
      // core.settings.value is jsonb - node-postgres already deserializes it
      // into a native JS value on read, unlike the type annotation below.
      const companyRes = await client.query<{ key: string; value: unknown }>(
        "select key, value from core.settings where key in ('company_name_ar', 'company_name_en', 'company_vat_number')"
      );
      const linesRes = await client.query<{ name_ar: string; name_en: string; qty: number; unit_price: string; vat_amount: string; line_total: string }>(
        "select name_ar, name_en, qty, unit_price, vat_amount, line_total from credit.invoice_lines where invoice_id = $1",
        [request.params.id]
      );
      return { invoice, supplier: supplierRes.rows[0]!, company: companyRes.rows, lines: linesRes.rows };
    });
    if (!result) throw new ApiError("NOT_FOUND");
    if (!result.invoice.zatca_uuid || !result.invoice.qr_tlv) throw new ApiError("CONFLICT");
    const getCompanyValue = (key: string): string => (result.company.find((r) => r.key === key)?.value as string | undefined) ?? "";

    const xml = generateUblXml({
      invoiceId: request.params.id,
      zatcaUuid: result.invoice.zatca_uuid,
      qrTlv: result.invoice.qr_tlv,
      issuedAt: result.invoice.issued_at,
      total: money(Number(result.invoice.total)),
      vatAmount: money(Number(result.invoice.vat_amount)),
      sellerNameAr: getCompanyValue("company_name_ar"),
      sellerNameEn: getCompanyValue("company_name_en"),
      sellerVatNumber: getCompanyValue("company_vat_number"),
      supplierNameAr: result.supplier.business_name_ar,
      supplierNameEn: result.supplier.business_name_en,
      lines: result.lines.map((l) => ({
        nameAr: l.name_ar,
        nameEn: l.name_en,
        qty: l.qty,
        unitPrice: money(Number(l.unit_price)),
        vatAmount: money(Number(l.vat_amount)),
        lineTotal: money(Number(l.line_total))
      }))
    });
    reply.header("content-type", "application/xml");
    return reply.code(200).send(xml);
  });

  // EP-SP-040 · POST /supplier/invoices/{id}/pay-proof · auth(supplier)
  app.post<{ Params: { id: string } }>("/api/v1/supplier/invoices/:id/pay-proof", async (request, reply) => {
    const { supplierId } = requireSupplier(request);
    const body = payProofRequest.parse(request.body);
    try {
      await withServiceRoleTransaction(async (client) => {
        await client.query("select credit.submit_payment_proof($1, $2, $3, $4, $5)", [
          request.params.id,
          supplierId,
          body.amount,
          body.bankRef,
          body.proofMediaId
        ]);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
      if (message.includes("PROOF_ALREADY_SUBMITTED")) throw new ApiError("PROOF_ALREADY_SUBMITTED");
      throw err;
    }
    return reply.code(202).send(payProofResponse.parse({ status: "pending_verification" }));
  });

  // EP-SP-041 · GET /supplier/payments · auth(supplier)
  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/api/v1/supplier/payments", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const { cursor, limit } = parsePagination(request.query);
    const after = cursor ? decodeCursor<{ verifiedAt: string; id: string }>(cursor) : null;

    const rows = await withRlsTransaction(actor, async (client) => {
      const conditions = ["verified_at is not null"];
      const params: unknown[] = [];
      if (after) {
        params.push(after.verifiedAt, after.id);
        conditions.push(`(verified_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }
      params.push(limit + 1);
      // verified_at_cursor: full microsecond precision as text, since `pg`
      // truncates verified_at to a millisecond-resolution JS Date and a
      // truncated cursor silently drops rows sharing a millisecond.
      const res = await client.query<{
        id: string;
        invoice_id: string;
        amount: string;
        verified_at: Date;
        verified_at_cursor: string;
      }>(
        `select id, invoice_id, amount, verified_at, verified_at::text as verified_at_cursor from credit.payments_received
         where ${conditions.join(" and ")} order by verified_at desc, id desc limit $${params.length}`,
        params
      );
      return res.rows;
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? encodeCursor({ verifiedAt: page[page.length - 1]!.verified_at_cursor, id: page[page.length - 1]!.id })
      : null;

    return reply.code(200).send(
      paymentListResponse.parse(
        buildPage(
          page.map((p) => ({ paymentId: p.id, invoiceId: p.invoice_id, amount: money(Number(p.amount)), verifiedAt: p.verified_at.toISOString() })),
          nextCursor
        )
      )
    );
  });

  // EP-SP-042 · GET /supplier/custody · auth(supplier) — Custody Funds ONLY,
  // never blended with a debt figure (D-14 rule f).
  app.get("/api/v1/supplier/custody", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const rows = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{
        custody_ref: string;
        order_id: string;
        amount: string;
        status: string;
        collected_at: Date;
        remitted_at: Date | null;
      }>("select custody_ref, order_id, amount, status, collected_at, remitted_at from credit.custody_ledger order by collected_at desc");
      return res.rows;
    });
    const heldTotal = rows.filter((r) => r.status === "held").reduce((sum, r) => sum + Number(r.amount), 0);
    const remittedTotal = rows.filter((r) => r.status === "remitted").reduce((sum, r) => sum + Number(r.amount), 0);
    return reply.code(200).send(
      custodyResponse.parse({
        heldTotal: money(heldTotal),
        remittedTotal: money(remittedTotal),
        items: rows.map((r) => ({
          custodyRef: r.custody_ref,
          orderId: r.order_id,
          amount: money(Number(r.amount)),
          status: r.status,
          collectedAt: r.collected_at.toISOString(),
          remittedAt: r.remitted_at ? r.remitted_at.toISOString() : null
        }))
      })
    );
  });

  // Pulled-forward AC-08 stand-in (SPEC-GAP, same precedent orders.ts's
  // verify-bank-transfer already set — no admin console exists until S18).
  app.post<{ Params: { id: string } }>(
    "/api/v1/supplier/invoices/:id/verify-payment",
    { preHandler: requirePermission("create", "payment") },
    async (request, reply) => {
      const actor = request.ctx.actor;
      if (!actor) throw new ApiError("INVALID_CREDENTIALS");
      const body = verifyPaymentRequest.parse(request.body);

      let result: { paymentId: string; invoiceStatus: string; openBalance: string };
      try {
        result = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ apply_verified_payment: { paymentId: string; invoiceStatus: string; openBalance: string } }>(
            "select credit.apply_verified_payment($1, $2, $3) as apply_verified_payment",
            [body.proofId, actor.sub, body.matchedBankRef ?? null]
          );
          return res.rows[0]!.apply_verified_payment;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("INVOICE_NOT_OPEN")) throw new ApiError("INVOICE_NOT_OPEN");
        throw err;
      }
      return reply.code(200).send(
        verifyPaymentResponse.parse({
          paymentId: result.paymentId,
          invoiceStatus: result.invoiceStatus,
          openBalance: money(Number(result.openBalance))
        })
      );
    }
  );
}
