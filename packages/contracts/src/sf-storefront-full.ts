import { z } from "zod";

// 10-customer-storefront/05-api-specification.md §5-8 (SF-06/07/08/09, S13).

// EP-SF-040 · GET /orders/{id}/tracking · auth
export const trackingResponse = z.object({
  status: z.string(),
  eta: z.string().datetime().nullable(),
  driver: z.object({ displayName: z.string(), vehicle: z.string().nullable() }).nullable(),
  otp: z.string().nullable(),
  taskId: z.string().uuid().nullable(),
  lastLocation: z.object({ lat: z.number(), lng: z.number(), at: z.string().datetime() }).nullable()
});

// EP-SF-041 · GET /orders/{id}/tracking/stream-token · auth
export const streamTokenResponse = z.object({
  channel: z.string(),
  statusChannel: z.string(),
  token: z.string(),
  expiresIn: z.number().int()
});

// EP-SF-050 · GET /orders/{id}/return-eligibility · auth
export const returnEligibilityResponse = z.object({
  eligible: z.boolean(),
  windowClosesAt: z.string().datetime().nullable(),
  lines: z.array(z.object({ orderLineId: z.string().uuid(), slug: z.string(), qtyEligible: z.number().int() }))
});

// EP-SF-051 · POST /orders/{id}/returns · auth
export const createReturnRequest = z.object({
  lines: z.array(z.object({ orderLineId: z.string().uuid(), qty: z.number().int().min(1), unopened: z.literal(true) })),
  reasonCode: z.enum(["wrong_item", "damaged", "changed_mind", "other"]),
  note: z.string().optional()
});
export const createReturnResponse = z.object({ returnId: z.string().uuid(), status: z.literal("requested") });

// EP-SF-052 · GET /returns · auth
export const returnListResponse = z.object({
  items: z.array(z.object({ returnId: z.string().uuid(), orderId: z.string().uuid(), status: z.string(), createdAt: z.string().datetime() })),
  nextCursor: z.string().nullable()
});
export type ReturnListResponse = z.infer<typeof returnListResponse>;

// EP-SF-053 · GET /returns/{id} · auth
export const returnDetailResponse = z.object({
  returnItem: z.object({
    returnId: z.string().uuid(),
    orderId: z.string().uuid(),
    status: z.string(),
    reasonCode: z.string(),
    note: z.string().nullable(),
    createdAt: z.string().datetime()
  }),
  lines: z.array(z.object({ orderLineId: z.string().uuid(), qty: z.number().int(), unopened: z.boolean() })),
  refund: z.object({ amount: z.string(), status: z.string() }).nullable()
});

// EP-SF-054 · POST /returns/{id}/refund-iban · auth
export const refundIbanRequest = z.object({ iban: z.string().min(15) });
export const refundIbanResponse = z.object({ status: z.literal("pending") });

// EP-SF-060 · POST /catalog/products/{slug}/reviews · auth
export const submitReviewRequest = z.object({ stars: z.number().int().min(1).max(5), body: z.string().max(1000).optional() });
export const submitReviewResponse = z.object({ reviewId: z.string().uuid(), status: z.literal("pending") });

// EP-SF-061 · GET /catalog/products/{slug}/reviews · public
export const reviewListResponse = z.object({
  items: z.array(z.object({ stars: z.number().int(), body: z.string().nullable(), authorDisplay: z.string(), createdAt: z.string().datetime() })),
  nextCursor: z.string().nullable(),
  summary: z.object({ avg: z.number(), count: z.number().int() })
});

// EP-SF-062 · PATCH /reviews/{id} · auth
export const editReviewRequest = z.object({ stars: z.number().int().min(1).max(5).optional(), body: z.string().max(1000).optional() });

// EP-SF-070 · GET /wishlist · auth
export const wishlistResponse = z.object({
  items: z.array(
    z.object({ skuId: z.string().uuid(), slug: z.string(), nameAr: z.string(), nameEn: z.string(), anyInStock: z.boolean(), backInStockOptin: z.boolean() })
  )
});
export type WishlistResponse = z.infer<typeof wishlistResponse>;

// EP-SF-071 · POST /wishlist · auth
export const addWishlistRequest = z.object({ skuId: z.string().uuid() });

// EP-SF-073 · POST /wishlist/{skuId}/back-in-stock · auth
export const backInStockRequest = z.object({ optin: z.boolean() });
