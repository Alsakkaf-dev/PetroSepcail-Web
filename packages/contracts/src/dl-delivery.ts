import { z } from "zod";

// 20-delivery-logistics/05-api-specification.md §2/3 (DL-01/DL-04, S10).
// delivery_status (D-04, core) — never redefined, same convention as
// sf-orders.ts's local orderStatus enum.
const deliveryStatus = z.enum([
  "assigned",
  "accepted",
  "at_pickup",
  "picked_up",
  "en_route",
  "arrived",
  "delivered",
  "confirmed",
  "failed"
]);

// EP-DL-010 · GET /driver/manifest · auth(driver)
export const manifestStop = z.object({
  taskId: z.string().uuid(),
  orderId: z.string().uuid(),
  stopType: z.enum(["b2b_drop", "b2c_home", "b2c_pickup"]),
  fulfillmentType: z.enum(["home_delivery", "pickup_point"]),
  status: deliveryStatus,
  routeSequence: z.number().int().nullable(),
  destination: z.object({ label: z.string(), lat: z.number().nullable(), lng: z.number().nullable() }),
  eta: z.string().datetime().nullable(),
  lines: z.array(z.object({ nameAr: z.string(), nameEn: z.string(), qty: z.number().int() }))
});
export const manifestResponse = z.object({ stops: z.array(manifestStop) });
export type ManifestResponse = z.infer<typeof manifestResponse>;

// EP-DL-011 · POST /driver/tasks/{id}/accept · auth(driver)
export const acceptTaskResponse = z.object({ status: deliveryStatus });

// EP-DL-012 · POST /driver/tasks/{id}/decline · auth(driver)
export const declineTaskResponse = z.object({ status: deliveryStatus });

// EP-DL-013 · GET /driver/tasks/{id} · auth(driver) — recipient PII present
// only while the task is active (04-roles §4.4); prices never included.
export const taskDetailResponse = z.object({
  task: z.object({
    taskId: z.string().uuid(),
    orderId: z.string().uuid(),
    stopType: z.enum(["b2b_drop", "b2c_home", "b2c_pickup"]),
    fulfillmentType: z.enum(["home_delivery", "pickup_point"]),
    status: deliveryStatus,
    routeSequence: z.number().int().nullable(),
    eta: z.string().datetime().nullable()
  }),
  recipient: z.object({ name: z.string(), phone: z.string() }).nullable(),
  lines: z.array(z.object({ nameAr: z.string(), nameEn: z.string(), qty: z.number().int() })),
  codAmount: z.string().nullable(),
  otpRequired: z.boolean()
});
export type TaskDetailResponse = z.infer<typeof taskDetailResponse>;

// EP-DL-020 · POST /driver/tasks/{id}/transition · auth(driver) · clientActionId
// 'delivered' requires POD (EP-DL-040, DL-05/S12) and 'failed' is its own
// endpoint (EP-DL-060, DL-09/S12) — not valid here, matching the API spec body.
export const transitionRequest = z.object({
  to: z.enum(["at_pickup", "picked_up", "en_route", "arrived"]),
  clientActionId: z.string().min(1),
  location: z.object({ lat: z.number(), lng: z.number() }).optional()
});
export const transitionResponse = z.object({ status: deliveryStatus });

// --- DL-07 (S11): shift & van load-out ------------------------------------

const stockLine = z.object({ packSizeId: z.string().uuid(), qty: z.number().int().nonnegative() });

// EP-DL-001 · POST /driver/shifts/start · auth(driver)
export const shiftStartRequest = z.object({ vanId: z.string().uuid(), load: z.array(stockLine) });
export const shiftStartResponse = z.object({ shiftId: z.string().uuid(), openingStock: z.array(stockLine) });

// EP-DL-002 · GET /driver/shift · auth(driver)
export const shiftResponse = z
  .object({
    shiftId: z.string().uuid(),
    vanId: z.string().uuid(),
    status: z.enum(["open", "reconciling", "closed"]),
    available: z.boolean(),
    vanStock: z.array(stockLine),
    custodyHeld: z.string()
  })
  .nullable();
export type ShiftResponse = z.infer<typeof shiftResponse>;

// EP-DL-003 · PATCH /driver/availability · auth(driver)
export const availabilityRequest = z.object({ available: z.boolean() });

// EP-DL-004 · POST /driver/shifts/{id}/reconcile · auth(driver)
export const reconcileRequest = z.object({ counted: z.array(stockLine) });
export const varianceLine = z.object({
  packSizeId: z.string().uuid(),
  expected: z.number().int(),
  counted: z.number().int(),
  delta: z.number().int()
});
export const reconcileResponse = z.object({ variance: z.array(varianceLine) });

// EP-DL-005 · POST /driver/shifts/{id}/remit-custody · auth(driver)
export const remitCustodyResponse = z.object({ remitted: z.number().int(), amount: z.string() });

// EP-DL-006 · POST /driver/shifts/{id}/close · auth(driver)
export const closeShiftResponse = z.object({ status: z.literal("closed") });

// --- DL-03 (S11): location streaming ---------------------------------------

// EP-DL-030 · POST /driver/tasks/{id}/pings · auth(driver)
export const pingsRequest = z.object({
  pings: z.array(
    z.object({
      lat: z.number(),
      lng: z.number(),
      heading: z.number().optional(),
      speed: z.number().optional(),
      at: z.string().datetime(),
      clientPingId: z.string().min(1)
    })
  )
});
export const pingsResponse = z.object({ accepted: z.number().int() });

// EP-DL-031 · GET /driver/tasks/{id}/publish-token · auth(driver)
export const publishTokenResponse = z.object({ channel: z.string(), token: z.string(), expiresIn: z.number().int() });

// EP-DL-014 · GET /driver/route · auth(driver) — DL-02 (S11). `legs`/
// `totalDurationS` are null when GOOGLE_MAPS_API_KEY is unconfigured or
// there are no active stops (mapsClient.ts degrades to null, not an error).
export const routeLeg = z.object({
  fromTaskId: z.string().uuid().nullable(),
  toTaskId: z.string().uuid(),
  distanceM: z.number(),
  durationS: z.number(),
  geometry: z.string()
});
export const routeResponse = z.object({ legs: z.array(routeLeg).nullable(), totalDurationS: z.number().nullable() });

// --- DL-05/09/06 (S12): POD, exceptions, audits, KPIs ----------------------

// EP-DL-040 · POST /driver/tasks/{id}/pod · auth(driver)
export const podRequest = z.object({
  photoMediaId: z.string().uuid(),
  otp: z.string().optional(),
  collectorKind: z.enum(["customer", "supplier"]),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  codCollectedAmount: z.number().optional(),
  clientActionId: z.string().min(1)
});
export const podResponse = z.object({ status: z.literal("delivered") });

// EP-DL-041 · POST /driver/tasks/{id}/otp/regenerate · auth(driver)
export const otpRegenerateResponse = z.object({ status: z.literal("regenerated") });

// EP-DL-060 · POST /driver/tasks/{id}/fail · auth(driver)
export const failTaskRequest = z.object({
  reasonCode: z.enum(["recipient_absent", "address_wrong", "refused", "unreachable", "other"]),
  note: z.string().optional(),
  clientActionId: z.string().min(1)
});
export const failTaskResponse = z.object({ status: deliveryStatus });

// EP-DL-061 · POST /driver/tasks/{id}/return-to-hub · auth(driver)
export const returnToHubResponse = z.object({ status: z.literal("returned") });

// EP-DL-070/071 · GET/POST /driver/audits · auth(driver)
export const auditListResponse = z.object({
  items: z.array(z.object({ auditId: z.string().uuid(), status: z.enum(["open", "closed", "exception"]), openedAt: z.string().datetime() }))
});
export const auditCountRequest = z.object({ counted: z.array(z.object({ packSizeId: z.string().uuid(), qty: z.number().int() })) });
export const auditCountResponse = z.object({
  variance: z.array(varianceLine),
  status: z.enum(["closed", "exception"])
});

// EP-DL-080 · GET /driver/kpis · auth(driver)
export const driverKpisResponse = z.object({
  onTimePct: z.number().nullable(),
  avgTimeToDeliverMin: z.number().nullable(),
  failedPct: z.number(),
  reconAccuracyPct: z.number().nullable(),
  custodyOnTimePct: z.number().nullable()
});

// Pulled-forward AC-05 stand-in (SPEC-GAP): the real fulfillment console
// (warehouse "pick complete" action) is AC-05, S18. orders.mark_ready_for_pickup
// (0035, S09) was built with no caller — DL-01 (S10) is the first session
// that needs one to exist for auto-assign to be exercisable at all. No EP-*
// id yet (not in any 05-api-specification.md); same precedent as
// verifyBankTransferResponse in sf-orders.ts.
export const readyForPickupResponse = z.object({ status: z.literal("ready_for_pickup") });
