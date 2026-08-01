import { z } from "zod";

// 30-supplier-portal/05-api-specification.md §4/5 (SP-04/SP-05, S15).
// invoice_status (D-04, core) — never redefined, same local-enum convention
// sf-orders.ts/dl-delivery.ts/sp-wholesale.ts already use.
const invoiceStatus = z.enum(["draft", "issued", "partially_paid", "paid", "overdue", "written_off"]);

// --- §4 Invoices (SP-04) -----------------------------------------------------

// EP-SP-030 · GET /supplier/invoices · auth(supplier)
export const invoiceListItem = z.object({
  invoiceId: z.string().uuid(),
  orderId: z.string().uuid(),
  status: invoiceStatus,
  total: z.string(),
  openBalance: z.string(),
  issuedAt: z.string().datetime(),
  dueAt: z.string().datetime(),
  zatcaUuid: z.string().uuid().nullable()
});
export const invoiceListResponse = z.object({ items: z.array(invoiceListItem), nextCursor: z.string().nullable() });

// EP-SP-031 · GET /supplier/invoices/{id} · auth(supplier)
export const invoiceLine = z.object({
  nameAr: z.string(),
  nameEn: z.string(),
  qty: z.number().int(),
  unitPrice: z.string(),
  vatAmount: z.string(),
  lineTotal: z.string()
});
export const invoiceDetailResponse = z.object({
  invoice: invoiceListItem,
  lines: z.array(invoiceLine),
  qrTlv: z.string().nullable(),
  deliveryDate: z.string().nullable()
});
export type InvoiceDetailResponse = z.infer<typeof invoiceDetailResponse>;

// EP-SP-032 · GET /supplier/invoices/{id}/pdf · auth(supplier) — SPEC-GAP:
// no PDF renderer / real object storage exists yet (same documented gap
// EP-SF-035's orderReceiptResponse already carries) — a same-origin JSON URL
// to the invoice detail endpoint, not a signed object-storage URL.
export const invoicePdfResponse = z.object({ pdfUrl: z.string(), expiresIn: z.number().int() });

// EP-SP-033 · GET /supplier/invoices/{id}/ubl · auth(supplier) — real XML,
// content-type application/xml, no JSON envelope; no zod schema needed on
// the wire (the route writes the raw string directly).

// --- §5 Payments & reconciliation (SP-05) ------------------------------------

// EP-SP-040 · POST /supplier/invoices/{id}/pay-proof · auth(supplier)
export const payProofRequest = z.object({
  amount: z.number().positive(),
  bankRef: z.string().min(1),
  proofMediaId: z.string().uuid()
});
export const payProofResponse = z.object({ status: z.literal("pending_verification") });

// EP-SP-041 · GET /supplier/payments · auth(supplier)
export const paymentListItem = z.object({
  paymentId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: z.string(),
  verifiedAt: z.string().datetime()
});
export const paymentListResponse = z.object({ items: z.array(paymentListItem), nextCursor: z.string().nullable() });

// EP-SP-042 · GET /supplier/custody · auth(supplier) — Custody Funds ONLY
// (D-14 rule f); never blended with a debt figure in the same object.
export const custodyItem = z.object({
  custodyRef: z.string().uuid(),
  orderId: z.string().uuid(),
  amount: z.string(),
  status: z.enum(["held", "remitted"]),
  collectedAt: z.string().datetime(),
  remittedAt: z.string().datetime().nullable()
});
export const custodyResponse = z.object({
  heldTotal: z.string(),
  remittedTotal: z.string(),
  items: z.array(custodyItem)
});

// Pulled-forward AC-08 stand-in (SPEC-GAP, same precedent
// orders.ts's verify-bank-transfer already set — no admin console exists
// until S18): POST /supplier/invoices/{id}/verify-payment.
export const verifyPaymentRequest = z.object({ proofId: z.string().uuid(), matchedBankRef: z.string().optional() });
export const verifyPaymentResponse = z.object({
  paymentId: z.string().uuid(),
  invoiceStatus: invoiceStatus,
  openBalance: z.string()
});
