import { z } from "zod";

// 40-admin-center/05-api-specification.md (AC-01/03/04/05/07/08/09/10, S17/S18).

// --- AC-01 Analytics ----------------------------------------------------------

export const salesKpiRow = z.object({
  day: z.string(),
  kind: z.string(),
  orders: z.number().int(),
  buyers: z.number().int(),
  gross: z.string(),
  discounts: z.string(),
  reversed: z.string()
});
export const salesAnalyticsResponse = z.object({ asOf: z.string().datetime(), rows: z.array(salesKpiRow) });
export type SalesAnalyticsResponse = z.infer<typeof salesAnalyticsResponse>;

export const bestsellerRow = z.object({ week: z.string(), skuId: z.string().uuid(), qty: z.number().int(), revenue: z.string() });
export const bestsellersResponse = z.object({ asOf: z.string().datetime(), rows: z.array(bestsellerRow) });

export const fulfillmentAnalyticsResponse = z.object({
  asOf: z.string().datetime(),
  onTimePct: z.number().nullable(),
  fulfillmentRate: z.number().nullable(),
  failedPct: z.number().nullable()
});
export type FulfillmentAnalyticsResponse = z.infer<typeof fulfillmentAnalyticsResponse>;

// --- AC-03 Credit management ---------------------------------------------------

export const adminSupplierListItem = z.object({
  supplierId: z.string().uuid(),
  businessNameAr: z.string(),
  businessNameEn: z.string(),
  tier: z.enum(["bronze", "silver", "gold"]),
  creditLimit: z.string(),
  exposure: z.string(),
  headroom: z.string()
});
export const adminSupplierListResponse = z.object({ items: z.array(adminSupplierListItem), nextCursor: z.string().nullable() });
export type AdminSupplierListResponse = z.infer<typeof adminSupplierListResponse>;

export const setCreditLimitRequest = z.object({ newLimit: z.number().positive(), reason: z.string().min(1) });
export const setCreditLimitResponse = z.object({ status: z.enum(["applied", "pending_dual_control"]), newLimit: z.string().optional() });

export const acknowledgeDualControlResponse = z.object({ status: z.literal("approved") });

export const setSupplierTierRequest = z.object({ tier: z.enum(["bronze", "silver", "gold"]), reason: z.string().min(1) });
export const setSupplierTierResponse = z.object({ status: z.literal("updated") });

export const creditOverrideRequest = z.object({ orderId: z.string().uuid(), reason: z.string().min(1) });
export const creditOverrideResponse = z.object({ status: z.literal("overridden") });

// --- AC-04 Promotions (thin forwarding surface; LE-02/03/04 don't exist yet — S19/S20) --

export const couponConfigRequest = z.object({
  code: z.string().min(1),
  type: z.enum(["percent", "fixed"]),
  value: z.number().positive(),
  constraints: z.record(z.unknown()).optional()
});
export const campaignConfigRequest = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  segment: z.string(),
  offers: z.array(z.unknown())
});
export const eligibilityRuleRequest = z.object({ rule: z.record(z.unknown()) });
export const promotionConfigResponse = z.object({ status: z.literal("queued"), note: z.string() });

// --- AC-05 Interventions --------------------------------------------------------

export const interventionListItem = z.object({
  id: z.string().uuid(),
  kind: z.enum(["force_cancel", "address_edit", "refund_override", "failed_delivery", "return_decision", "review_moderation"]),
  orderId: z.string().uuid().nullable(),
  reasonCode: z.string(),
  outcome: z.enum(["open", "resolved", "rejected"]),
  createdAt: z.string().datetime()
});
export const interventionListResponse = z.object({ items: z.array(interventionListItem), nextCursor: z.string().nullable() });

export const forceCancelRequest = z.object({ reasonCode: z.string().min(1), note: z.string().optional() });
export const forceCancelResponse = z.object({ status: z.literal("cancelled") });

export const addressEditRequest = z.object({ addressSnapshot: z.record(z.unknown()), reasonCode: z.string().min(1) });
export const addressEditResponse = z.object({ status: z.literal("updated") });

export const returnDecisionRequest = z.object({ decision: z.enum(["approve", "reject"]), reasonCode: z.string().min(1) });
export const returnDecisionResponse = z.object({ status: z.enum(["approved", "rejected"]) });

export const reviewModerateRequest = z.object({ action: z.enum(["hide", "remove"]), reasonCode: z.string().min(1) });
export const reviewModerateResponse = z.object({ status: z.literal("moderated") });

// --- AC-07 Audit log -------------------------------------------------------------

export const auditLogItem = z.object({
  at: z.string().datetime(),
  actorId: z.string().uuid().nullable(),
  role: z.string().nullable(),
  action: z.string(),
  resource: z.string(),
  resourceId: z.string().nullable(),
  reason: z.string().nullable()
});
export const auditLogResponse = z.object({ items: z.array(auditLogItem), nextCursor: z.string().nullable() });
export type AuditLogResponse = z.infer<typeof auditLogResponse>;

export const verifyChainResponse = z.object({ intact: z.boolean(), brokenAt: z.array(z.number()).optional() });
export type VerifyChainResponse = z.infer<typeof verifyChainResponse>;

// --- AC-08 Finance / receivables / custody oversight ----------------------------

export const receivableItem = z.object({
  supplierId: z.string().uuid(),
  exposure: z.string(),
  creditLimit: z.string(),
  aging: z.object({ b0_30: z.string(), b31_60: z.string(), b61_90: z.string(), b90plus: z.string() })
});
export const receivablesResponse = z.object({ items: z.array(receivableItem), nextCursor: z.string().nullable() });

export const verificationQueueItem = z.object({
  kind: z.enum(["bank_transfer", "custody_remittance"]),
  refId: z.string().uuid(),
  claimedAmount: z.string(),
  submittedBy: z.string().uuid().nullable(),
  submittedAt: z.string().datetime()
});
export const verificationQueueResponse = z.object({ items: z.array(verificationQueueItem) });

export const custodyRemittanceVerifyRequest = z.object({ amount: z.number().positive() });
export const custodyRemittanceVerifyResponse = z.object({ status: z.literal("remitted") });

export const invoiceWriteOffRequest = z.object({ reason: z.string().min(1) });
export const invoiceWriteOffResponse = z.object({ status: z.literal("written_off") });

export const custodyHolder = z.object({
  holderKind: z.enum(["driver", "supplier"]),
  holderId: z.string().uuid(),
  heldTotal: z.string(),
  remittedTotal: z.string()
});
export const adminCustodyResponse = z.object({ holders: z.array(custodyHolder) });

// --- AC-09 Fleet oversight --------------------------------------------------------

export const fleetMapTokenResponse = z.object({ channel: z.literal("admin:fleet"), token: z.string(), expiresIn: z.number().int() });

export const fleetKpiRow = z.object({
  driverId: z.string().uuid(),
  onTimePct: z.number().nullable(),
  avgTimeToDeliverMin: z.number().nullable(),
  failedPct: z.number().nullable(),
  reconAccuracyPct: z.number().nullable(),
  custodyOnTimePct: z.number().nullable()
});
export const fleetKpisResponse = z.object({ rows: z.array(fleetKpiRow) });
export type FleetKpisResponse = z.infer<typeof fleetKpisResponse>;

export const setAuditCadenceRequest = z.object({
  entityKind: z.enum(["driver", "supplier"]),
  entityId: z.string().uuid(),
  intervalDays: z.number().int().positive()
});
export const setAuditCadenceResponse = z.object({ status: z.literal("updated") });

export const fleetAlertItem = z.object({ kind: z.string(), ref: z.string(), severity: z.enum(["low", "medium", "high"]) });
export const fleetAlertsResponse = z.object({ items: z.array(fleetAlertItem) });
export type FleetAlertsResponse = z.infer<typeof fleetAlertsResponse>;

export const reassignTaskRequest = z.object({ driverId: z.string().uuid(), reason: z.string().min(1) });
export const reassignTaskResponse = z.object({ status: z.literal("reassigned") });

// --- AC-10 PII / PDPL / breach ------------------------------------------------

export const adminReadCustomerRequest = z.object({ customerId: z.string().uuid(), reason: z.string().min(1) });
export const adminReadCustomerResponse = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  email: z.string(),
  status: z.string()
});
export type AdminReadCustomerResponse = z.infer<typeof adminReadCustomerResponse>;

export const pdplRequestCreate = z.object({ subjectId: z.string().uuid(), kind: z.enum(["access", "correction", "deletion"]) });
export const pdplRequestResponse = z.object({
  id: z.string().uuid(),
  status: z.enum(["received", "in_grace", "executing", "completed", "rejected"]),
  graceUntil: z.string().nullable()
});

export const pdplAdvanceResponse = z.object({ status: z.enum(["received", "in_grace", "executing", "completed", "rejected"]) });

export const breachCreateRequest = z.object({ detectedAt: z.string().datetime(), scope: z.string().min(1) });
export const breachResponse = z.object({ id: z.string().uuid(), notifyBy: z.string().datetime(), status: z.literal("open") });

export const aggregationCheckResponse = z.object({
  views: z.array(z.object({ name: z.string(), minCellCount: z.number().int(), ok: z.boolean() }))
});
