import { z } from "zod";

// 10-customer-storefront/05-api-specification.md §2 (Cart, SF-03).

export const cartLine = z.object({
  lineId: z.string().uuid(),
  packSizeId: z.string().uuid(),
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  qty: z.number().int(),
  unitPrice: z.string(),
  inStock: z.boolean(),
  priceUpdated: z.boolean().optional()
});
export type CartLine = z.infer<typeof cartLine>;

export const cartTotals = z.object({
  subtotal: z.string(),
  vat: z.string(),
  discount: z.string(),
  total: z.string()
});
export type CartTotals = z.infer<typeof cartTotals>;

// EP-SF-010 · GET /cart · auth
export const cartResponse = z.object({
  cartId: z.string().uuid(),
  lines: z.array(cartLine),
  coupon: z.object({ code: z.string(), discountSar: z.string() }).nullable(),
  totals: cartTotals,
  freeDeliveryRemaining: z.string().nullable()
});
export type CartResponse = z.infer<typeof cartResponse>;

// EP-SF-011 · POST /cart/lines · auth
export const addCartLineRequest = z.object({
  packSizeId: z.string().uuid(),
  qty: z.number().int().min(1).max(99)
});
export type AddCartLineRequest = z.infer<typeof addCartLineRequest>;

export const cartLineMutationResponse = z.object({ line: cartLine, totals: cartTotals });

// EP-SF-012 · PATCH /cart/lines/{lineId} · auth
export const updateCartLineRequest = z.object({ qty: z.number().int().min(1).max(99) });
export type UpdateCartLineRequest = z.infer<typeof updateCartLineRequest>;

// EP-SF-013 · DELETE /cart/lines/{lineId} · auth
export const cartTotalsResponse = z.object({ totals: cartTotals });

// EP-SF-014 · POST /cart/coupon · auth
export const applyCouponRequest = z.object({ code: z.string().min(1) });
export type ApplyCouponRequest = z.infer<typeof applyCouponRequest>;

export const applyCouponResponse = z.discriminatedUnion("valid", [
  z.object({ valid: z.literal(true), discountSar: z.string(), totals: cartTotals }),
  z.object({ valid: z.literal(false), reason: z.string() })
]);
export type ApplyCouponResponse = z.infer<typeof applyCouponResponse>;
