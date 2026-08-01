import { z } from "zod";

// 30-supplier-portal/05-api-specification.md §7/8 (SP-08/09, S16).
// EP-SP-060/061/062 (B2B tracking) reuse sf-storefront-full.ts's
// trackingResponse/streamTokenResponse directly -- identical shape, same
// underlying delivery.delivery_tasks/pods tables, no reason to duplicate.

// EP-SP-062 · GET /supplier/orders/{id}/pod · auth(supplier)
export const supplierPodResponse = z.object({ photoUrl: z.string(), deliveredAt: z.string().datetime() });

// EP-SP-070 · GET/POST/PATCH/DELETE /supplier/templates · auth(supplier) —
// templates store NO price (FR-SP09-001) — re-priced fresh at reorder.
export const templateLine = z.object({ packSizeId: z.string().uuid(), qty: z.number().int().positive() });
export const createTemplateRequest = z.object({ name: z.string().min(1), lines: z.array(templateLine).min(1) });
export const updateTemplateRequest = z.object({ name: z.string().min(1).optional(), lines: z.array(templateLine).min(1).optional() });
export const templateItem = z.object({ templateId: z.string().uuid(), name: z.string(), lines: z.array(templateLine) });
export const templateListResponse = z.object({ items: z.array(templateItem) });
export const templateMutationResponse = z.object({ template: templateItem });

// EP-SP-071/072 · POST /supplier/templates/{id}/reorder · POST /supplier/orders/{id}/reorder
// auth(supplier) · idempotencyKey — builds a fresh, re-priced cart line set
// for confirmation via EP-SP-003; discontinued lines dropped with a notice.
export const supplierReorderLine = z.object({ packSizeId: z.string().uuid(), skuSlug: z.string(), qty: z.number().int(), tierUnitPrice: z.string() });
export const supplierReorderDroppedLine = z.object({ skuSlug: z.string(), reason: z.enum(["discontinued", "out_of_stock"]) });
export const supplierReorderResponse = z.object({ lines: z.array(supplierReorderLine), dropped: z.array(supplierReorderDroppedLine) });
