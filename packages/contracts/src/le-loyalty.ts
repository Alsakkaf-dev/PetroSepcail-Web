import { z } from "zod";

// 50-loyalty-engine/05-api-specification.md (LE-01/05/07, S19/S20). LE has
// no standalone frontend (fragments embed in SF/SP) — these are the raw
// data endpoints those fragments call.

// EP-LE-001 · GET /loyalty/points/balance · auth(customer)
export const pointsBalanceResponse = z.object({ balance: z.number().int() });

// EP-LE-002 · GET /loyalty/points/history · auth(customer)
export const pointsHistoryItem = z.object({
  kind: z.enum(["earn", "redeem", "reverse", "expire", "restore"]),
  points: z.number().int(),
  orderId: z.string().uuid().nullable(),
  at: z.string().datetime()
});
export const pointsHistoryResponse = z.object({ items: z.array(pointsHistoryItem), nextCursor: z.string().nullable() });

// EP-X-003 · POST /loyalty/redemption/quote · auth(customer)
export const redemptionQuoteRequest = z.object({ pointsRequested: z.number().int().nonnegative(), orderTotal: z.number().nonnegative() });
export const redemptionQuoteResponse = z.object({ allowedPoints: z.number().int(), discountSar: z.string() });

// EP-LE-030 · GET /supplier/rewards · auth(supplier) — supplier-facing
// incentives read (early-pay + volume); rewards land on the debt side
// (SP-06 applies the credit note), never blended with custody.
export const rewardItem = z.object({
  kind: z.enum(["early_pay", "volume"]),
  valueSar: z.string(),
  sourceRef: z.string().nullable(),
  createdAt: z.string().datetime()
});
export const rewardListResponse = z.object({ items: z.array(rewardItem) });

// EP-LE-040 · GET /loyalty/campaigns/active · public/auth(customer) —
// audience-filtered active campaign banners.
export const activeCampaignItem = z.object({
  id: z.string().uuid(),
  nameAr: z.string(),
  nameEn: z.string(),
  endsAt: z.string().datetime()
});
export const activeCampaignsResponse = z.object({ items: z.array(activeCampaignItem) });
