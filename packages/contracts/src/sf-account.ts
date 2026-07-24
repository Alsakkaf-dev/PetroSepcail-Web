import { z } from "zod";

// 10-customer-storefront/05-api-specification.md §9 (SF-10, S09).

// EP-SF-080 · GET /account/overview · auth
export const accountOverviewResponse = z.object({
  recentOrders: z.array(z.object({ orderId: z.string().uuid(), status: z.string(), total: z.string(), placedAt: z.string().datetime() })),
  pointsBalance: z.number().int(),
  addressCount: z.number().int(),
  openReturns: z.number().int()
});

// EP-SF-081 · GET /account/loyalty · auth — read-through LE-01 (S19); no
// write path here. LE-01 doesn't exist yet, so this is a documented
// contract-honoring stub (same "seam" precedent SF-03/S08 used for LE-02's
// coupon-validate stub) — always returns a zero balance until S19 replaces it.
export const loyaltyOverviewResponse = z.object({
  balance: z.number().int(),
  redeemRate: z.object({ points: z.number().int(), sar: z.number() }),
  entries: z.array(z.object({ delta: z.number().int(), reason: z.string(), at: z.string().datetime() }))
});

// EP-SF-082 · GET/PUT /account/notification-preferences · auth. `in_app` is
// intentionally absent (FR-SF10-005: "in-app always on", never configurable).
const notificationChannel = z.enum(["email", "web_push", "sms"]);
export const notificationPreferenceItem = z.object({
  notificationType: z.string(),
  channel: notificationChannel,
  enabled: z.boolean()
});
export const notificationPreferencesResponse = z.object({ items: z.array(notificationPreferenceItem) });
export const notificationPreferencesUpdateRequest = z.object({
  items: z.array(z.object({ notificationType: z.string(), channel: notificationChannel, enabled: z.boolean() })).min(1)
});

// EP-SF-083 · GET /account/consents · PATCH /account/consents · auth
const consentKind = z.enum(["service_terms", "privacy", "marketing"]);
export const consentItem = z.object({ kind: consentKind, granted: z.boolean(), policyVersion: z.string(), at: z.string().datetime() });
export const consentsResponse = z.object({ items: z.array(consentItem) });
export const consentsUpdateRequest = z.object({ marketing: z.boolean() });

// EP-SF-084 · POST /account/export · auth (PDPL subject-access, FR-SF10-008,
// SHOULD-priority). SPEC-GAP: the spec's own §9 describes a 202-then-poll
// job shape, but no job-queue infrastructure exists anywhere in this repo
// (Vercel Cron is scheduling-only, no background-job runner) — building a
// fake async job for a single small JSON payload would be complexity with no
// real benefit, so this returns the export synchronously (200, not 202).
// Flagged here rather than silently deviating from the doc.
export const accountExportResponse = z.object({
  generatedAt: z.string().datetime(),
  identity: z.record(z.string(), z.unknown()),
  addresses: z.array(z.record(z.string(), z.unknown())),
  orders: z.array(z.record(z.string(), z.unknown()))
});
