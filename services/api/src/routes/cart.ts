import {
  addCartLineRequest,
  applyCouponRequest,
  applyCouponResponse,
  cartLineMutationResponse,
  cartResponse,
  cartTotalsResponse,
  updateCartLineRequest
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { getVatRate, money } from "../catalog/pricing.js";
import { validateCoupon } from "../checkout/couponStub.js";
import { withRlsTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import type { AccessTokenClaims } from "../security/jwt.js";

interface LineRow {
  line_id: string;
  pack_size_id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  qty: number;
  unit_price: string;
  current_price: string;
  in_stock: boolean | null;
}

async function getOrCreateOpenCart(client: PoolClient, userId: string): Promise<string> {
  const existing = await client.query<{ id: string }>("select id from orders.carts where user_id = $1 and status = 'open'", [
    userId
  ]);
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await client.query<{ id: string }>(
    "insert into orders.carts (user_id) values ($1) returning id",
    [userId]
  );
  return created.rows[0]!.id;
}

// FR-SF03-007: opening the cart refreshes each line's unit price from the
// authority (catalog.resolve_retail_price) — a changed price is written back
// onto the snapshot AND reported via `priceUpdated` for this one response.
async function loadLines(client: PoolClient, cartId: string): Promise<{ rows: LineRow[]; priceUpdated: Set<string> }> {
  const res = await client.query<LineRow>(
    `select cl.id as line_id, cl.pack_size_id, s.slug, s.name_ar, s.name_en, cl.qty,
            cl.unit_price, catalog.resolve_retail_price(cl.pack_size_id) as current_price,
            a.in_stock
     from orders.cart_lines cl
     join catalog.pack_sizes p on p.id = cl.pack_size_id
     join catalog.skus s on s.id = p.sku_id
     left join catalog.v_sku_availability a on a.pack_size_id = cl.pack_size_id
     where cl.cart_id = $1
     order by cl.created_at`,
    [cartId]
  );
  const priceUpdated = new Set<string>();
  for (const row of res.rows) {
    if (row.current_price !== null && row.current_price !== row.unit_price) {
      priceUpdated.add(row.line_id);
      await client.query("update orders.cart_lines set unit_price = $2 where id = $1", [row.line_id, row.current_price]);
      row.unit_price = row.current_price;
    }
  }
  return { rows: res.rows, priceUpdated };
}

async function computeTotals(client: PoolClient, cartId: string, vatRate: number, userId: string) {
  const { rows, priceUpdated } = await loadLines(client, cartId);
  const subtotal = rows.reduce((sum, r) => sum + Number(r.unit_price) * r.qty, 0);
  const vat = subtotal * vatRate;
  const cart = await client.query<{ coupon_code: string | null }>("select coupon_code from orders.carts where id = $1", [cartId]);
  const couponCode = cart.rows[0]?.coupon_code ?? null;

  // FR-SF03-007-equivalent: re-validate live on every read (same "prices
  // refresh on open" precedent loadLines already sets) rather than trusting
  // a stale stored discount — a coupon can expire, hit its cap, or stop
  // meeting min_order between when it was applied and now.
  let discount = 0;
  if (couponCode) {
    const res = await client.query<{ result: { valid: boolean; discountSar: string | null } }>(
      "select loyalty.validate_coupon($1, $2, $3) as result",
      [couponCode, userId, subtotal + vat]
    );
    const result = res.rows[0]?.result;
    if (result?.valid && result.discountSar !== null) discount = Number(result.discountSar);
  }
  const total = subtotal + vat - discount;
  return {
    rows,
    priceUpdated,
    couponCode: cart.rows[0]?.coupon_code ?? null,
    totals: { subtotal: money(subtotal), vat: money(vat), discount: money(discount), total: money(total) },
    subtotalInclVat: subtotal + vat
  };
}

async function getFreeDeliveryRemaining(client: PoolClient, subtotalInclVat: number): Promise<string | null> {
  const res = await client.query<{ value: string }>("select core.get_setting('free_delivery_threshold') as value", []);
  const threshold = Number(res.rows[0]?.value ?? 0);
  const remaining = threshold - subtotalInclVat;
  return remaining > 0 ? money(remaining) : null;
}

function toCartResponse(cartId: string, data: Awaited<ReturnType<typeof computeTotals>>, freeDeliveryRemaining: string | null) {
  return cartResponse.parse({
    cartId,
    lines: data.rows.map((r) => ({
      lineId: r.line_id,
      packSizeId: r.pack_size_id,
      slug: r.slug,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      qty: r.qty,
      unitPrice: money(Number(r.unit_price)),
      inStock: r.in_stock ?? false,
      ...(data.priceUpdated.has(r.line_id) ? { priceUpdated: true } : {})
    })),
    coupon: data.couponCode && Number(data.totals.discount) > 0 ? { code: data.couponCode, discountSar: data.totals.discount } : null,
    totals: data.totals,
    freeDeliveryRemaining
  });
}

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

export function registerCartRoutes(app: FastifyInstance): void {
  // EP-SF-010 · GET /cart · auth
  app.get("/api/v1/cart", async (request, reply) => {
    const actor = requireActor(request);
    const vatRate = await getVatRate();
    const result = await withRlsTransaction(actor, async (client) => {
      const cartId = await getOrCreateOpenCart(client, actor.sub);
      const data = await computeTotals(client, cartId, vatRate, actor.sub);
      const freeDeliveryRemaining = await getFreeDeliveryRemaining(client, data.subtotalInclVat);
      return { cartId, data, freeDeliveryRemaining };
    });
    return reply.code(200).send(toCartResponse(result.cartId, result.data, result.freeDeliveryRemaining));
  });

  // EP-SF-011 · POST /cart/lines · auth
  app.post("/api/v1/cart/lines", async (request, reply) => {
    const actor = requireActor(request);
    const body = addCartLineRequest.parse(request.body);
    const vatRate = await getVatRate();

    const result = await withRlsTransaction(actor, async (client) => {
      const cartId = await getOrCreateOpenCart(client, actor.sub);
      const price = await client.query<{ resolve_retail_price: string }>(
        "select catalog.resolve_retail_price($1) as resolve_retail_price",
        [body.packSizeId]
      );
      const unitPrice = price.rows[0]?.resolve_retail_price;
      if (unitPrice === null || unitPrice === undefined) throw new ApiError("NOT_FOUND");

      const availability = await client.query<{ in_stock: boolean }>(
        "select in_stock from catalog.v_sku_availability where pack_size_id = $1",
        [body.packSizeId]
      );
      if (!availability.rows[0]?.in_stock) throw new ApiError("CART_LINE_UNAVAILABLE");

      await client.query(
        `insert into orders.cart_lines (cart_id, pack_size_id, qty, unit_price)
         values ($1, $2, $3, $4)
         on conflict (cart_id, pack_size_id) do update
           set qty = least(orders.cart_lines.qty + excluded.qty, 99), unit_price = excluded.unit_price`,
        [cartId, body.packSizeId, body.qty, unitPrice]
      );
      const data = await computeTotals(client, cartId, vatRate, actor.sub);
      const line = data.rows.find((r) => r.pack_size_id === body.packSizeId)!;
      return { line, totals: data.totals };
    });

    return reply.code(201).send(
      cartLineMutationResponse.parse({
        line: {
          lineId: result.line.line_id,
          packSizeId: result.line.pack_size_id,
          slug: result.line.slug,
          nameAr: result.line.name_ar,
          nameEn: result.line.name_en,
          qty: result.line.qty,
          unitPrice: money(Number(result.line.unit_price)),
          inStock: result.line.in_stock ?? false
        },
        totals: result.totals
      })
    );
  });

  // EP-SF-012 · PATCH /cart/lines/{lineId} · auth
  app.patch<{ Params: { lineId: string } }>("/api/v1/cart/lines/:lineId", async (request, reply) => {
    const actor = requireActor(request);
    const body = updateCartLineRequest.parse(request.body);
    const vatRate = await getVatRate();

    const result = await withRlsTransaction(actor, async (client) => {
      const cartId = await getOrCreateOpenCart(client, actor.sub);
      const updated = await client.query(
        "update orders.cart_lines set qty = $2 where id = $1 and cart_id = $3 returning id",
        [request.params.lineId, body.qty, cartId]
      );
      if (updated.rows.length === 0) throw new ApiError("NOT_FOUND");
      const data = await computeTotals(client, cartId, vatRate, actor.sub);
      const line = data.rows.find((r) => r.line_id === request.params.lineId)!;
      return { line, totals: data.totals };
    });

    return reply.code(200).send(
      cartLineMutationResponse.parse({
        line: {
          lineId: result.line.line_id,
          packSizeId: result.line.pack_size_id,
          slug: result.line.slug,
          nameAr: result.line.name_ar,
          nameEn: result.line.name_en,
          qty: result.line.qty,
          unitPrice: money(Number(result.line.unit_price)),
          inStock: result.line.in_stock ?? false
        },
        totals: result.totals
      })
    );
  });

  // EP-SF-013 · DELETE /cart/lines/{lineId} · auth
  app.delete<{ Params: { lineId: string } }>("/api/v1/cart/lines/:lineId", async (request, reply) => {
    const actor = requireActor(request);
    const vatRate = await getVatRate();
    const totals = await withRlsTransaction(actor, async (client) => {
      const cartId = await getOrCreateOpenCart(client, actor.sub);
      await client.query("delete from orders.cart_lines where id = $1 and cart_id = $2", [request.params.lineId, cartId]);
      const data = await computeTotals(client, cartId, vatRate, actor.sub);
      return data.totals;
    });
    return reply.code(200).send(cartTotalsResponse.parse({ totals }));
  });

  // EP-SF-014 · POST /cart/coupon · auth
  app.post("/api/v1/cart/coupon", async (request, reply) => {
    const actor = requireActor(request);
    const body = applyCouponRequest.parse(request.body);
    const vatRate = await getVatRate();
    const locale = request.ctx.locale ?? "ar";

    const outcome = await withRlsTransaction(actor, async (client) => {
      const cartId = await getOrCreateOpenCart(client, actor.sub);
      const before = await computeTotals(client, cartId, vatRate, actor.sub);
      const result = await validateCoupon(client, body.code, actor.sub, before.subtotalInclVat);
      if (!result.valid) return { valid: false as const, reason: locale === "en" ? result.reasonEn : result.reasonAr };

      await client.query("update orders.carts set coupon_code = $2 where id = $1", [cartId, body.code]);
      const after = await computeTotals(client, cartId, vatRate, actor.sub);
      return { valid: true as const, discountSar: money(result.discountSar ?? 0), totals: after.totals };
    });

    return reply.code(200).send(
      outcome.valid
        ? applyCouponResponse.parse({ valid: true, discountSar: outcome.discountSar, totals: outcome.totals })
        : applyCouponResponse.parse({ valid: false, reason: outcome.reason ?? "" })
    );
  });

  // EP-SF-015 · DELETE /cart/coupon · auth
  app.delete("/api/v1/cart/coupon", async (request, reply) => {
    const actor = requireActor(request);
    const vatRate = await getVatRate();
    const totals = await withRlsTransaction(actor, async (client) => {
      const cartId = await getOrCreateOpenCart(client, actor.sub);
      await client.query("update orders.carts set coupon_code = null where id = $1", [cartId]);
      const data = await computeTotals(client, cartId, vatRate, actor.sub);
      return data.totals;
    });
    return reply.code(200).send(cartTotalsResponse.parse({ totals }));
  });
}
