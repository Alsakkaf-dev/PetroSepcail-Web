import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withRlsTransaction, withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";

// EP-SF-031 (SF-05, S09) — full order list/detail/timeline/receipt/reorder
// is that session's job. This is a minimal, pulled-forward GET /orders/{id}
// (detail only) because SF-04's own confirmation screen (SCR-SF04-002)
// structurally needs to display the order it just placed — same pattern as
// this session's address-book/admin-SKU-list pull-forwards. S09 owns
// extending this into the full EP-SF-030..035 set.
export function registerOrderRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>("/api/v1/orders/:id", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");

    const result = await withRlsTransaction(actor, async (client) => {
      const orderRes = await client.query(
        `select id, status, kind, payment_method, fulfillment_type, subtotal, vat_amount,
                discount_amount, delivery_fee, total, cod_amount, address_snapshot, delivery_slot, placed_at
         from orders.orders where id = $1 and user_id = $2`,
        [request.params.id, actor.sub]
      );
      const order = orderRes.rows[0];
      if (!order) return null;

      const linesRes = await client.query(
        "select sku_slug, name_ar, name_en, qty, unit_price, line_vat, line_total from orders.order_lines where order_id = $1",
        [request.params.id]
      );
      const paymentRes = await client.query(
        "select method, status, bank_ref, proof_media_id from orders.payments where order_id = $1 order by created_at desc limit 1",
        [request.params.id]
      );
      return { order, lines: linesRes.rows, payment: paymentRes.rows[0] ?? null };
    });

    if (!result) throw new ApiError("NOT_FOUND");
    const { order, lines, payment } = result;

    let payTo: { iban: string; holder: string } | undefined;
    if (order.status === "pending_payment") {
      payTo = await withServiceRoleTransaction(async (client) => {
        const iban = await client.query<{ get_setting: string }>("select core.get_setting('company_iban') as get_setting");
        const holder = await client.query<{ get_setting: string }>(
          "select core.get_setting('company_iban_holder') as get_setting"
        );
        return { iban: iban.rows[0]!.get_setting, holder: holder.rows[0]!.get_setting };
      });
    }

    return reply.code(200).send({
      orderId: order.id,
      status: order.status,
      kind: order.kind,
      paymentMethod: order.payment_method,
      fulfillmentType: order.fulfillment_type,
      subtotal: money(Number(order.subtotal)),
      vat: money(Number(order.vat_amount)),
      discount: money(Number(order.discount_amount)),
      deliveryFee: money(Number(order.delivery_fee)),
      total: money(Number(order.total)),
      codAmount: order.cod_amount !== null ? money(Number(order.cod_amount)) : null,
      addressSnapshot: order.address_snapshot,
      slot: order.delivery_slot,
      placedAt: order.placed_at.toISOString(),
      lines: lines.map((l) => ({
        skuSlug: l.sku_slug,
        nameAr: l.name_ar,
        nameEn: l.name_en,
        qty: l.qty,
        unitPrice: money(Number(l.unit_price)),
        lineVat: money(Number(l.line_vat)),
        lineTotal: money(Number(l.line_total))
      })),
      payment: payment
        ? { method: payment.method, status: payment.status, bankRef: payment.bank_ref, proofMediaId: payment.proof_media_id }
        : null,
      ...(payTo ? { payTo } : {})
    });
  });
}
