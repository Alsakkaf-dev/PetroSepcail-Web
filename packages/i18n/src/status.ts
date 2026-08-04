// D-04 canonical enums with their display labels.
//
// 00-INDEX.md §4.4 is binding: "Defined once in D-04 (PROGRESS.md Part B),
// reproduced verbatim in 03-domain-glossary.md, never redefined locally. Any
// status value not in D-04 is a defect." Arabic labels below are copied from
// 03-domain-glossary.md §9 exactly; English labels are the display side of the
// same table.
//
// Nothing may render a bare enum value. `statusLabel()` is the only way a
// status reaches a screen.

import type { Locale } from "./locale";

/**
 * Semantic tone, so a badge's colour is a property of the status rather than
 * a decision each screen re-makes. Colour is never the only signal — every
 * badge also carries its label, and the D-14 finance separation is carried by
 * heading and label, not tone.
 */
export type StatusTone = "neutral" | "info" | "progress" | "success" | "warn" | "danger";

interface StatusEntry {
  ar: string;
  en: string;
  tone: StatusTone;
}

/** D-04 `order_status · حالة الطلب` — 13 values. */
export const ORDER_STATUS: Record<string, StatusEntry> = {
  pending_payment: { ar: "بانتظار الدفع", en: "Awaiting payment", tone: "warn" },
  paid: { ar: "مدفوع", en: "Paid", tone: "success" },
  confirmed: { ar: "مؤكد", en: "Confirmed", tone: "info" },
  preparing: { ar: "قيد التجهيز", en: "Preparing", tone: "progress" },
  ready_for_pickup: { ar: "جاهز للاستلام", en: "Ready for pickup", tone: "progress" },
  assigned: { ar: "تم إسناد مندوب", en: "Driver assigned", tone: "progress" },
  picked_up: { ar: "تم الاستلام من المستودع", en: "Picked up", tone: "progress" },
  en_route: { ar: "في الطريق إليك", en: "On the way", tone: "progress" },
  delivered: { ar: "تم التوصيل", en: "Delivered", tone: "success" },
  confirmed_received: { ar: "تم تأكيد الاستلام", en: "Receipt confirmed", tone: "success" },
  cancelled: { ar: "ملغي", en: "Cancelled", tone: "neutral" },
  refunded: { ar: "مسترد", en: "Refunded", tone: "neutral" },
  returned: { ar: "مرتجع", en: "Returned", tone: "neutral" }
};

/** D-04 `delivery_status · حالة التوصيل` — 8 states plus terminal failure. */
export const DELIVERY_STATUS: Record<string, StatusEntry> = {
  assigned: { ar: "مُسند", en: "Assigned", tone: "info" },
  accepted: { ar: "مقبول", en: "Accepted", tone: "progress" },
  at_pickup: { ar: "عند المستودع", en: "At source", tone: "progress" },
  picked_up: { ar: "تم التحميل", en: "Picked up", tone: "progress" },
  en_route: { ar: "في الطريق", en: "En route", tone: "progress" },
  arrived: { ar: "وصل", en: "Arrived", tone: "progress" },
  delivered: { ar: "تم التسليم", en: "Delivered", tone: "success" },
  confirmed: { ar: "مؤكد", en: "Confirmed", tone: "success" },
  failed: { ar: "فشل التسليم", en: "Delivery failed", tone: "danger" }
};

/** D-04 `invoice_status · حالة الفاتورة` — 6 values. */
export const INVOICE_STATUS: Record<string, StatusEntry> = {
  draft: { ar: "مسودة", en: "Draft", tone: "neutral" },
  issued: { ar: "صادرة", en: "Issued", tone: "info" },
  partially_paid: { ar: "مدفوعة جزئياً", en: "Partially paid", tone: "progress" },
  paid: { ar: "مدفوعة", en: "Paid", tone: "success" },
  overdue: { ar: "متأخرة", en: "Overdue", tone: "danger" },
  written_off: { ar: "معدومة", en: "Written off", tone: "neutral" }
};

/**
 * D-04 `payment_method · طريقة الدفع`.
 *
 * Three are active at launch and three are defined-but-dormant (D-11). The
 * dormant ones keep their labels so the supplier portal can render the
 * "Coming Soon · قريباً" control structurally, disabled — but no screen may
 * render an *enabled* card control while `payments.cards.enabled` is false.
 */
export const PAYMENT_METHOD: Record<string, StatusEntry> = {
  cod: { ar: "الدفع عند الاستلام", en: "Cash on delivery", tone: "neutral" },
  bank_transfer: { ar: "تحويل بنكي", en: "Bank transfer", tone: "neutral" },
  credit_terms: { ar: "آجل", en: "Credit terms", tone: "neutral" },
  mada: { ar: "مدى", en: "mada", tone: "neutral" },
  stc_pay: { ar: "إس تي سي باي", en: "STC Pay", tone: "neutral" },
  apple_pay: { ar: "آبل باي", en: "Apple Pay", tone: "neutral" }
};

/** Payment methods a checkout may actually offer today (D-11 / D-14 rule e). */
export const ACTIVE_PAYMENT_METHODS = ["cod", "bank_transfer", "credit_terms"] as const;

export const STATUS_SETS = {
  order: ORDER_STATUS,
  delivery: DELIVERY_STATUS,
  invoice: INVOICE_STATUS,
  payment: PAYMENT_METHOD
} as const;

export type StatusKind = keyof typeof STATUS_SETS;

/**
 * The localized label for an enum value.
 *
 * Falls back to the raw value only so an unknown status can still be seen
 * during development — in production an unknown value is a D-04 defect and
 * should be filed against the owning spec, not styled around.
 */
export function statusLabel(kind: StatusKind, locale: Locale, value: string): string {
  const entry = STATUS_SETS[kind][value];
  return entry ? entry[locale] : value;
}

export function statusTone(kind: StatusKind, value: string): StatusTone {
  return STATUS_SETS[kind][value]?.tone ?? "neutral";
}
