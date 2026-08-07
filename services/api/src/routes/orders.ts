import { orderDetailResponse, orderListResponse, cancelOrderResponse, confirmReceiptResponse, reorderResponse, orderReceiptResponse, verifyBankTransferResponse } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withRlsTransaction, withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import { requirePermission } from "../gateway/requirePermission.js";
import type { AccessTokenClaims } from "../security/jwt.js";

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

interface OrderListRow {
  id: string;
  status: string;
  total: string;
  payment_method: string;
  placed_at: Date;
  placed_at_cursor: string;
  delivery_slot: string;
}
interface OrderListCursor {
  placedAt: string;
  id: string;
}

// SF-05 (S09) — full EP-SF-030..035 order lifecycle, extending the minimal
// pulled-forward GET /orders/{id} S08 built (SCR-SF04-002's own confirmation
// screen needed it). Cancel/confirm-receipt/mirror route through the 0035
// SECURITY DEFINER functions (0027_orders_rls.sql: "UPDATE is SECURITY
// DEFINER-only, no broad UPDATE policy granted" — the same reason
// place_order runs over withServiceRoleTransaction).
export function registerOrderRoutes(app: FastifyInstance): void {
  // EP-SF-030 · GET /orders · auth
  app.get<{ Querystring: { status?: string; cursor?: string; limit?: string } }>(
    "/api/v1/orders",
    async (request, reply) => {
      const actor = requireActor(request);
      const { cursor, limit } = parsePagination(request.query);
      const after = cursor ? decodeCursor<OrderListCursor>(cursor) : null;

      const rows = await withRlsTransaction(actor, async (client) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (request.query.status) {
          params.push(request.query.status);
          conditions.push(`status = $${params.length}`);
        }
        if (after) {
          params.push(after.placedAt, after.id);
          conditions.push(`(placed_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
        }
        params.push(limit + 1);
        const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
        const res = await client.query<OrderListRow>(
          // placed_at_cursor: full microsecond precision as text, since `pg`
          // truncates placed_at to a millisecond-resolution JS Date and a
          // truncated cursor silently drops rows sharing a millisecond.
          `select id, status, total, payment_method, placed_at, placed_at::text as placed_at_cursor, delivery_slot
           from orders.orders
           ${where}
           order by placed_at desc, id desc
           limit $${params.length}`,
          params
        );
        return res.rows;
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? encodeCursor({ placedAt: page[page.length - 1]!.placed_at_cursor, id: page[page.length - 1]!.id })
        : null;

      return reply.code(200).send(
        orderListResponse.parse(
          buildPage(
            page.map((o) => ({
              orderId: o.id,
              status: o.status,
              total: money(Number(o.total)),
              paymentMethod: o.payment_method,
              placedAt: o.placed_at.toISOString(),
              slot: o.delivery_slot
            })),
            nextCursor
          )
        )
      );
    }
  );

  // EP-SF-031 · GET /orders/{id} · auth
  app.get<{ Params: { id: string } }>("/api/v1/orders/:id", async (request, reply) => {
    const actor = requireActor(request);

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
      const historyRes = await client.query<{ status: string; at: Date }>(
        "select status, at from orders.status_history where order_id = $1 order by at",
        [request.params.id]
      );
      // DL-05 FR-DL05-002 (S12): the delivery OTP is read here, not pushed —
      // no SMS vendor exists (0049's own note), so the customer's own order
      // page is the delivery channel; only visible while a task is 'arrived'
      // (the driver is at the door and actually needs it read aloud).
      const otpRes = await client.query<{ otp_code: string | null }>(
        "select otp_code from delivery.delivery_tasks where order_id = $1 and status = 'arrived'",
        [request.params.id]
      );
      return {
        order,
        lines: linesRes.rows,
        payment: paymentRes.rows[0] ?? null,
        history: historyRes.rows,
        deliveryOtp: otpRes.rows[0]?.otp_code ?? null
      };
    });

    if (!result) throw new ApiError("NOT_FOUND");
    const { order, lines, payment, history, deliveryOtp } = result;

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

    // FR-SF05-004: the first reached status is derived (not stored — see
    // db/migrations/0037's own comment), COD orders started 'confirmed',
    // bank_transfer orders started 'pending_payment'.
    const timeline = [
      { status: order.payment_method === "cod" ? "confirmed" : "pending_payment", at: order.placed_at.toISOString() },
      ...history.map((h) => ({ status: h.status, at: h.at.toISOString() }))
    ];

    return reply.code(200).send(
      orderDetailResponse.parse({
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
        timeline,
        deliveryOtp,
        ...(payTo ? { payTo } : {})
      })
    );
  });

  // EP-SF-032 · POST /orders/{id}/cancel · auth — FR-SF05-007
  app.post<{ Params: { id: string } }>("/api/v1/orders/:id/cancel", async (request, reply) => {
    const actor = requireActor(request);
    let status: string;
    try {
      status = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ cancel_order: string }>("select orders.cancel_order($1, $2) as cancel_order", [
          request.params.id,
          actor.sub
        ]);
        return res.rows[0]!.cancel_order;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
      if (message.includes("ORDER_NOT_CANCELLABLE")) throw new ApiError("ORDER_NOT_CANCELLABLE");
      throw err;
    }
    return reply.code(200).send(cancelOrderResponse.parse({ status }));
  });

  // EP-SF-033 · POST /orders/{id}/confirm-receipt · auth — FR-SF05-006, idempotent
  app.post<{ Params: { id: string } }>("/api/v1/orders/:id/confirm-receipt", async (request, reply) => {
    const actor = requireActor(request);
    let status: string;
    try {
      status = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ confirm_receipt: string }>(
          "select orders.confirm_receipt($1, $2) as confirm_receipt",
          [request.params.id, actor.sub]
        );
        return res.rows[0]!.confirm_receipt;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
      if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
      throw err;
    }
    return reply.code(200).send(confirmReceiptResponse.parse({ status }));
  });

  // EP-SF-034 · POST /orders/{id}/reorder · auth — FR-SF05-005
  app.post<{ Params: { id: string } }>("/api/v1/orders/:id/reorder", async (request, reply) => {
    const actor = requireActor(request);

    const result = await withRlsTransaction(actor, async (client) => {
      const linesRes = await client.query<{ pack_size_id: string; sku_slug: string; qty: number }>(
        `select ol.pack_size_id, ol.sku_slug, ol.qty from orders.order_lines ol
         join orders.orders o on o.id = ol.order_id
         where ol.order_id = $1 and o.user_id = $2`,
        [request.params.id, actor.sub]
      );
      if (linesRes.rows.length === 0) throw new ApiError("NOT_FOUND");

      let cartId = (
        await client.query<{ id: string }>("select id from orders.carts where user_id = $1 and status = 'open'", [actor.sub])
      ).rows[0]?.id;
      if (!cartId) {
        cartId = (await client.query<{ id: string }>("insert into orders.carts (user_id) values ($1) returning id", [actor.sub]))
          .rows[0]!.id;
      }

      const added: Array<{ skuSlug: string; packSizeId: string; qty: number }> = [];
      const dropped: Array<{ skuSlug: string; reason: "discontinued" | "out_of_stock" }> = [];
      for (const line of linesRes.rows) {
        const price = await client.query<{ resolve_retail_price: string | null }>(
          "select catalog.resolve_retail_price($1) as resolve_retail_price",
          [line.pack_size_id]
        );
        const currentPrice = price.rows[0]?.resolve_retail_price;
        if (currentPrice === null || currentPrice === undefined) {
          dropped.push({ skuSlug: line.sku_slug, reason: "discontinued" });
          continue;
        }
        const availability = await client.query<{ in_stock: boolean }>(
          "select in_stock from catalog.v_sku_availability where pack_size_id = $1",
          [line.pack_size_id]
        );
        if (!availability.rows[0]?.in_stock) {
          dropped.push({ skuSlug: line.sku_slug, reason: "out_of_stock" });
          continue;
        }
        await client.query(
          `insert into orders.cart_lines (cart_id, pack_size_id, qty, unit_price)
           values ($1, $2, $3, $4)
           on conflict (cart_id, pack_size_id) do update
             set qty = least(orders.cart_lines.qty + excluded.qty, 99), unit_price = excluded.unit_price`,
          [cartId, line.pack_size_id, line.qty, currentPrice]
        );
        added.push({ skuSlug: line.sku_slug, packSizeId: line.pack_size_id, qty: line.qty });
      }
      return { cartId, added, dropped };
    });

    return reply.code(200).send(reorderResponse.parse(result));
  });

  // EP-SF-035 · GET /orders/{id}/receipt · auth · owner-only — FR-SF05-010.
  // SPEC-GAP: no PDF/document renderer exists anywhere in this repo yet and
  // Vercel Blob (ADR-17) isn't wired for real storage (services/api/src/media
  // still targets the retired MinIO — see S08 handover). Returns a
  // same-origin JSON receipt endpoint URL rather than a signed object-storage
  // URL; a future session replaces this once real storage is wired.
  app.get<{ Params: { id: string } }>("/api/v1/orders/:id/receipt", async (request, reply) => {
    const actor = requireActor(request);
    const exists = await withRlsTransaction(actor, async (client) => {
      const res = await client.query("select 1 from orders.orders where id = $1 and user_id = $2", [
        request.params.id,
        actor.sub
      ]);
      return res.rowCount! > 0;
    });
    if (!exists) throw new ApiError("NOT_FOUND");
    return reply.code(200).send(
      orderReceiptResponse.parse({
        receiptUrl: `/api/v1/orders/${request.params.id}`,
        expiresIn: 3600
      })
    );
  });

  // Pulled-forward AC-08 stand-in (SPEC-GAP, see db/migrations/0035) — admin
  // gate reuses the "payment" resource (admin: create,read per authz.ts),
  // the closest existing MATRIX entry to a payment-verification action.
  app.post<{ Params: { id: string } }>(
    "/api/v1/orders/:id/verify-bank-transfer",
    { preHandler: requirePermission("create", "payment") },
    async (request, reply) => {
      const actor = requireActor(request);
      let status: string;
      try {
        status = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ verify_bank_transfer: string }>(
            "select orders.verify_bank_transfer($1, $2) as verify_bank_transfer",
            [request.params.id, actor.sub]
          );
          return res.rows[0]!.verify_bank_transfer;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(verifyBankTransferResponse.parse({ status }));
    }
  );
}
