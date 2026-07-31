import { z } from "zod";

// 10-customer-storefront/05-api-specification.md §4 (SF-05, S09). Money
// fields are decimal strings (money() helper in services/api), matching
// every other contract in this package (sf-checkout.ts precedent).
const orderStatus = z.enum([
  "pending_payment",
  "paid",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "assigned",
  "picked_up",
  "en_route",
  "delivered",
  "confirmed_received",
  "cancelled",
  "refunded",
  "returned"
]);

// EP-SF-030 · GET /orders · auth
export const orderListItem = z.object({
  orderId: z.string().uuid(),
  status: orderStatus,
  total: z.string(),
  paymentMethod: z.enum(["cod", "bank_transfer", "credit_terms", "mada", "stc_pay", "apple_pay"]),
  placedAt: z.string().datetime(),
  slot: z.string()
});
export const orderListResponse = z.object({
  items: z.array(orderListItem),
  nextCursor: z.string().nullable()
});
export type OrderListResponse = z.infer<typeof orderListResponse>;

// EP-SF-031 · GET /orders/{id} · auth — full detail incl. timeline.
export const orderLineItem = z.object({
  skuSlug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  qty: z.number().int(),
  unitPrice: z.string(),
  lineVat: z.string(),
  lineTotal: z.string()
});
export const orderTimelineEntry = z.object({ status: orderStatus, at: z.string().datetime() });
export const orderDetailResponse = z.object({
  orderId: z.string().uuid(),
  status: orderStatus,
  kind: z.enum(["retail", "wholesale"]),
  paymentMethod: z.enum(["cod", "bank_transfer", "credit_terms", "mada", "stc_pay", "apple_pay"]),
  fulfillmentType: z.enum(["home_delivery", "pickup_point"]),
  subtotal: z.string(),
  vat: z.string(),
  discount: z.string(),
  deliveryFee: z.string(),
  total: z.string(),
  codAmount: z.string().nullable(),
  addressSnapshot: z.record(z.string(), z.unknown()),
  slot: z.string(),
  placedAt: z.string().datetime(),
  lines: z.array(orderLineItem),
  payment: z
    .object({
      method: z.string(),
      status: z.string(),
      bankRef: z.string().nullable(),
      proofMediaId: z.string().uuid().nullable()
    })
    .nullable(),
  timeline: z.array(orderTimelineEntry),
  // DL-05 FR-DL05-002 (S12) — set only while a delivery task is 'arrived';
  // null otherwise (no OTP minted yet, or delivery already completed).
  deliveryOtp: z.string().nullable(),
  payTo: z.object({ iban: z.string(), holder: z.string() }).optional()
});
export type OrderDetailResponse = z.infer<typeof orderDetailResponse>;

// EP-SF-032 · POST /orders/{id}/cancel · auth
export const cancelOrderResponse = z.object({ status: orderStatus });

// EP-SF-033 · POST /orders/{id}/confirm-receipt · auth (idempotent)
export const confirmReceiptResponse = z.object({ status: orderStatus });

// EP-SF-034 · POST /orders/{id}/reorder · auth
export const reorderResponse = z.object({
  cartId: z.string().uuid(),
  added: z.array(z.object({ skuSlug: z.string(), packSizeId: z.string().uuid(), qty: z.number().int() })),
  dropped: z.array(z.object({ skuSlug: z.string(), reason: z.enum(["discontinued", "out_of_stock"]) }))
});

// EP-SF-035 · GET /orders/{id}/receipt · auth · owner-only
export const orderReceiptResponse = z.object({ receiptUrl: z.string(), expiresIn: z.number().int() });

// Pulled-forward AC-08 stand-in (SPEC-GAP, see db/migrations/0035) — admin-
// only, exercises the pending_payment -> paid -> confirmed edge the M2 gate
// requires. No EP-* id yet (not in 10-customer-storefront/05-api-
// specification.md); the real console lands at S18 with its own EP-AC-07x id.
export const verifyBankTransferResponse = z.object({ status: orderStatus });
