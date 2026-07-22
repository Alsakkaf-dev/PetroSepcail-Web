import { z } from "zod";

// 10-customer-storefront/05-api-specification.md §3 (Checkout, SF-04).

// EP-SF-020 · POST /checkout/quote · auth
export const checkoutQuoteRequest = z.object({ addressId: z.string().uuid() });
export type CheckoutQuoteRequest = z.infer<typeof checkoutQuoteRequest>;

export const checkoutQuoteResponse = z.object({
  inRadius: z.literal(true),
  deliveryFee: z.string(),
  freeDelivery: z.boolean(),
  slots: z.array(z.object({ code: z.enum(["same_day", "next_am", "next_pm"]), label: z.string(), cutoffPassed: z.boolean() }))
});
export type CheckoutQuoteResponse = z.infer<typeof checkoutQuoteResponse>;

// EP-SF-022 · POST /orders · auth · Idempotency-Key
export const placeOrderRequest = z.object({
  cartId: z.string().uuid(),
  addressId: z.string().uuid(),
  slot: z.enum(["same_day", "next_am", "next_pm"]),
  paymentMethod: z.enum(["cod", "bank_transfer"]),
  fulfillmentType: z.enum(["home_delivery", "pickup_point"]).optional(),
  pickupLocationId: z.string().uuid().optional()
});
export type PlaceOrderRequest = z.infer<typeof placeOrderRequest>;

export const placeOrderResponse = z.discriminatedUnion("status", [
  z.object({ orderId: z.string().uuid(), status: z.literal("confirmed"), total: z.string(), codAmount: z.string() }),
  z.object({
    orderId: z.string().uuid(),
    status: z.literal("pending_payment"),
    total: z.string(),
    payTo: z.object({ iban: z.string(), holder: z.string() }),
    payWindowHours: z.number()
  })
]);
export type PlaceOrderResponse = z.infer<typeof placeOrderResponse>;

// EP-SF-023 · POST /orders/{id}/bank-transfer-proof · auth · Idempotency-Key
export const bankTransferProofRequest = z.object({
  amount: z.string(),
  bankRef: z.string().min(1),
  proofMediaId: z.string().uuid()
});
export type BankTransferProofRequest = z.infer<typeof bankTransferProofRequest>;

export const bankTransferProofResponse = z.object({ status: z.literal("pending_verification") });
