import { bankTransferProofRequest, checkoutQuoteRequest, placeOrderRequest } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { getVatRate, money } from "../catalog/pricing.js";
import { quoteDelivery } from "../checkout/deliveryQuote.js";
import { withRlsTransaction, withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { publishEvent } from "../events/publishEvent.js";
import type { AccessTokenClaims } from "../security/jwt.js";

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

async function getCartSubtotalInclVat(actor: AccessTokenClaims, vatRate: number): Promise<number> {
  return withRlsTransaction(actor, async (client) => {
    const res = await client.query<{ unit_price: string; qty: number }>(
      `select cl.unit_price, cl.qty from orders.cart_lines cl
       join orders.carts c on c.id = cl.cart_id
       where c.user_id = $1 and c.status = 'open'`,
      [actor.sub]
    );
    const subtotal = res.rows.reduce((sum, r) => sum + Number(r.unit_price) * r.qty, 0);
    return subtotal + subtotal * vatRate;
  });
}

export function registerCheckoutRoutes(app: FastifyInstance): void {
  // EP-SF-020 · POST /checkout/quote · auth
  app.post("/api/v1/checkout/quote", async (request, reply) => {
    const actor = requireActor(request);
    const body = checkoutQuoteRequest.parse(request.body);

    const address = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ lat: string | null; lng: string | null }>(
        "select lat, lng from core.addresses where id = $1 and identity_id = $2",
        [body.addressId, actor.sub]
      );
      return res.rows[0];
    });
    if (!address) throw new ApiError("NOT_FOUND");

    const vatRate = await getVatRate();
    const subtotalInclVat = await getCartSubtotalInclVat(actor, vatRate);
    const quote = await quoteDelivery(
      { lat: address.lat !== null ? Number(address.lat) : null, lng: address.lng !== null ? Number(address.lng) : null },
      subtotalInclVat
    );

    if (!quote.inRadius) throw new ApiError("OUT_OF_DELIVERY_RADIUS");
    return reply.code(200).send({
      inRadius: true,
      deliveryFee: quote.deliveryFee,
      freeDelivery: quote.freeDelivery,
      slots: quote.slots
    });
  });

  // EP-SF-022 · POST /orders · auth · Idempotency-Key
  app.post("/api/v1/orders", async (request, reply) => {
    const actor = requireActor(request);
    const body = placeOrderRequest.parse(request.body);
    const idempotencyKey = (request.headers["idempotency-key"] as string | undefined) ?? null;

    // Cart ownership is checked (any status), but NOT required to be 'open'
    // here: an idempotent replay (FR-SF04-008 AC2) targets a cart that's
    // already 'converted' from the original successful call, and
    // orders.place_order's own idempotency check runs before its own
    // open-cart check — this route must not reject a valid replay first.
    const addressAndCart = await withRlsTransaction(actor, async (client) => {
      const addressRes = await client.query(
        "select id, label, recipient_name, phone, line1, line2, district, city, lat, lng from core.addresses where id = $1 and identity_id = $2",
        [body.addressId, actor.sub]
      );
      const cartRes = await client.query<{ id: string }>("select id from orders.carts where id = $1 and user_id = $2", [
        body.cartId,
        actor.sub
      ]);
      return { address: addressRes.rows[0], cart: cartRes.rows[0] };
    });
    if (!addressAndCart.address) throw new ApiError("NOT_FOUND");
    if (!addressAndCart.cart) throw new ApiError("NOT_FOUND");

    const vatRate = await getVatRate();
    const subtotalInclVat = await getCartSubtotalInclVat(actor, vatRate);
    const address = addressAndCart.address;
    const quote = await quoteDelivery(
      { lat: address.lat !== null ? Number(address.lat) : null, lng: address.lng !== null ? Number(address.lng) : null },
      subtotalInclVat
    );
    if (!quote.inRadius) throw new ApiError("OUT_OF_DELIVERY_RADIUS");

    // The error-mapping catch deliberately sits OUTSIDE withServiceRoleTransaction:
    // db.ts's runInTransaction treats a thrown ApiError as a controlled
    // business outcome and COMMITS regardless (correct for auth's own
    // intentional-side-effects-on-failure use case) — but a rejected
    // place_order call (COD_LIMIT_EXCEEDED etc.) must roll back its own
    // partial catalog.reserve_stock calls from earlier in the loop. Mapping
    // to ApiError only after the real rollback already happened is what
    // keeps this atomic.
    let result: { order_id: string; status: "confirmed" | "pending_payment"; total: string; cod_amount: string | null; is_replay: boolean };
    try {
      result = await withServiceRoleTransaction(async (client) => {
        const res = await client.query(
          `select * from orders.place_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            actor.sub,
            body.cartId,
            body.paymentMethod,
            JSON.stringify(address),
            body.slot,
            idempotencyKey,
            body.fulfillmentType ?? "home_delivery",
            body.pickupLocationId ?? null,
            quote.deliveryFee,
            "0.00"
          ]
        );
        return res.rows[0] as {
          order_id: string;
          status: "confirmed" | "pending_payment";
          total: string;
          cod_amount: string | null;
          is_replay: boolean;
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("CART_EMPTY")) throw new ApiError("CART_EMPTY");
      if (message.includes("PRICE_CHANGED")) throw new ApiError("PRICE_CHANGED");
      if (message.includes("COD_LIMIT_EXCEEDED")) throw new ApiError("COD_LIMIT_EXCEEDED");
      if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
      throw err;
    }

    if (result.status === "confirmed") {
      return reply.code(201).send({
        orderId: result.order_id,
        status: "confirmed",
        total: money(Number(result.total)),
        codAmount: money(Number(result.cod_amount))
      });
    }

    const settings = await withServiceRoleTransaction(async (client) => {
      const iban = await client.query<{ get_setting: string }>("select core.get_setting('company_iban') as get_setting");
      const holder = await client.query<{ get_setting: string }>(
        "select core.get_setting('company_iban_holder') as get_setting"
      );
      const windowHours = await client.query<{ get_setting: string }>(
        "select core.get_setting('bank_transfer_window_hours') as get_setting"
      );
      return { iban: iban.rows[0]!.get_setting, holder: holder.rows[0]!.get_setting, windowHours: Number(windowHours.rows[0]!.get_setting) };
    });

    return reply.code(201).send({
      orderId: result.order_id,
      status: "pending_payment",
      total: money(Number(result.total)),
      payTo: { iban: settings.iban, holder: settings.holder },
      payWindowHours: settings.windowHours
    });
  });

  // EP-SF-023 · POST /orders/{id}/bank-transfer-proof · auth · Idempotency-Key
  app.post<{ Params: { id: string } }>("/api/v1/orders/:id/bank-transfer-proof", async (request, reply) => {
    const actor = requireActor(request);
    const body = bankTransferProofRequest.parse(request.body);

    // core.outbox (publishEvent) is service_role-only by design (no
    // app_user grant at all — 0004/0006_rls_policies.sql) — FR-PC05-001
    // requires the event write in the SAME transaction as the state change,
    // so this whole handler runs over service_role with an explicit
    // ownership check, the same pattern config.ts/adminCatalog.ts use for
    // any route that both mutates owner-scoped data and emits an event.
    await withServiceRoleTransaction(async (client) => {
      const order = await client.query<{ status: string; placed_at: Date }>(
        "select status, placed_at from orders.orders where id = $1 and user_id = $2",
        [request.params.id, actor.sub]
      );
      if (order.rows.length === 0) throw new ApiError("NOT_FOUND");
      if (order.rows[0]!.status !== "pending_payment") throw new ApiError("CONFLICT");

      const windowRes = await client.query<{ get_setting: string }>(
        "select core.get_setting('bank_transfer_window_hours') as get_setting"
      );
      const windowHours = Number(windowRes.rows[0]?.get_setting ?? 48);
      const deadline = new Date(order.rows[0]!.placed_at.getTime() + windowHours * 3600_000);
      if (new Date() > deadline) throw new ApiError("PAYMENT_WINDOW_EXPIRED");

      await client.query(
        `insert into orders.payments (order_id, method, amount, status, bank_ref, proof_media_id)
         values ($1, 'bank_transfer', $2, 'pending', $3, $4)`,
        [request.params.id, body.amount, body.bankRef, body.proofMediaId]
      );
      await publishEvent(client, {
        name: "payments.bank_transfer.proof_submitted", // EV-PC-017
        actorSub: actor.sub,
        actorRole: actor.role,
        payload: {
          order_id_or_invoice_id: request.params.id,
          claimed_amount: body.amount,
          reference: body.bankRef,
          proof_media_id: body.proofMediaId,
          submitted_by: actor.sub
        }
      });
    });

    return reply.code(202).send({ status: "pending_verification" });
  });
}
