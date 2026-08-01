import { z } from "zod";

// 30-supplier-portal/05-api-specification.md §6 (SP-06, S16).

const aging = z.object({ b0_30: z.string(), b31_60: z.string(), b61_90: z.string(), b90plus: z.string() });

// EP-SP-050 · GET /supplier/statement · auth(supplier) · ?periodStart=&periodEnd=
export const statementLine = z.object({
  kind: z.enum(["invoice", "payment", "credit_note"]),
  refId: z.string().uuid(),
  amount: z.string(),
  at: z.string().datetime()
});
export const statementResponse = z.object({
  opening: z.string(),
  invoicesTotal: z.string(),
  paymentsTotal: z.string(),
  creditNotesTotal: z.string(),
  closing: z.string(),
  aging,
  lines: z.array(statementLine)
});

// EP-SP-051 · GET /supplier/statement/pdf · auth(supplier) — same SPEC-GAP
// same-origin-JSON fallback as invoicePdfResponse (no PDF renderer/object
// storage wired yet).
export const statementPdfResponse = z.object({ pdfUrl: z.string(), expiresIn: z.number().int() });

// EP-SP-052 · GET /supplier/dashboard · auth(supplier) — three SEPARATE
// objects that never sum (D-14 rule f / NFR-SP-002); a client blending them
// into one figure would be a defect.
export const supplierDashboardResponse = z.object({
  debt: z.object({
    exposure: z.string(),
    creditLimit: z.string(),
    headroom: z.string(),
    aging,
    openInvoices: z.number().int()
  }),
  custodyCash: z.object({ heldTotal: z.string(), remittedTotal: z.string() }),
  goodsCustody: z.object({ count: z.number().int() })
});
