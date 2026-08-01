import { z } from "zod";

// 30-supplier-portal/05-api-specification.md §1/2/3 (SP-01/02/03, S14).
// order_status (D-04, core) — never redefined, same local-enum convention
// sf-orders.ts/dl-delivery.ts already use.
const orderStatus = z.enum([
  "pending_payment",
  "paid",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "assigned",
  "picked_up",
  "en_route",
  "delivered",
  "confirmed_received",
  "cancelled",
  "refunded",
  "returned"
]);

// --- §1 Wholesale ordering & cart (SP-01) -----------------------------------

// EP-SP-001 · GET /supplier/catalog · auth(supplier)
export const supplierCatalogItem = z.object({
  packSizeId: z.string().uuid(),
  skuSlug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  tierUnitPrice: z.string(),
  inStock: z.boolean()
});
export const supplierCatalogResponse = z.object({
  items: z.array(supplierCatalogItem),
  nextCursor: z.string().nullable()
});

// EP-SP-002 · GET/POST/PATCH/DELETE /supplier/cart · auth(supplier)
export const cartLineInput = z.object({ packSizeId: z.string().uuid(), qty: z.number().int().positive() });
export const supplierCartLine = z.object({
  packSizeId: z.string().uuid(),
  skuSlug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  qty: z.number().int(),
  tierUnitPrice: z.string()
});
export const supplierCartResponse = z.object({
  lines: z.array(supplierCartLine),
  subtotal: z.string(),
  vatAmount: z.string(),
  total: z.string()
});
export type SupplierCartResponse = z.infer<typeof supplierCartResponse>;

// EP-SP-003 · POST /supplier/orders · auth(supplier) · idempotencyKey
export const placeWholesaleOrderRequest = z.object({
  lines: z.array(cartLineInput).min(1),
  paymentMethod: z.enum(["credit_terms", "bank_transfer"]),
  addressId: z.string().uuid(),
  deliverySlot: z.string().optional(),
  idempotencyKey: z.string().min(1).optional()
});
export const placeWholesaleOrderResponse = z.object({
  orderId: z.string().uuid(),
  status: orderStatus,
  total: z.string()
});
export type PlaceWholesaleOrderResponse = z.infer<typeof placeWholesaleOrderResponse>;

// EP-SP-004 · POST /supplier/orders/{id}/cancel · auth(supplier)
export const cancelWholesaleOrderResponse = z.object({ status: z.literal("cancelled") });

// EP-SP-005 · GET /supplier/orders · auth(supplier)
export const supplierOrderListItem = z.object({
  orderId: z.string().uuid(),
  status: orderStatus,
  total: z.string(),
  placedAt: z.string().datetime()
});
export const supplierOrderListResponse = z.object({
  items: z.array(supplierOrderListItem),
  nextCursor: z.string().nullable()
});

// --- §2 Supplier profile & pickup-point (SP-01) -----------------------------

// EP-SP-010 · GET /supplier/profile · auth(supplier)
export const supplierProfileResponse = z.object({
  businessNameAr: z.string(),
  businessNameEn: z.string(),
  tier: z.enum(["bronze", "silver", "gold"]),
  creditLimit: z.string(),
  isPickupPoint: z.boolean(),
  geo: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  bank: z.object({ name: z.string().nullable(), ibanMasked: z.string().nullable() })
});
export type SupplierProfileResponse = z.infer<typeof supplierProfileResponse>;

// EP-SP-011 · PATCH /supplier/profile · auth(supplier) — tier/creditLimit/
// isPickupPoint deliberately absent: rejected 403 FORBIDDEN if sent, enforced
// structurally (credit.update_supplier_profile has no such parameter).
export const updateSupplierProfileRequest = z.object({
  contact: z.object({ businessNameAr: z.string().optional(), businessNameEn: z.string().optional() }).optional(),
  bank: z.object({ name: z.string().optional(), iban: z.string().optional() }).optional()
});
export const updateSupplierProfileResponse = z.object({ status: z.literal("updated") });

// EP-SP-012 · GET /pickup-points · public (no auth)
export const pickupPoint = z.object({
  supplierId: z.string().uuid(),
  businessNameAr: z.string(),
  businessNameEn: z.string(),
  geo: z.object({ lat: z.number(), lng: z.number() }),
  distanceKm: z.number().nullable()
});
export const pickupPointsResponse = z.object({ items: z.array(pickupPoint) });

// --- §3 Tier pricing (SP-02) -------------------------------------------------

// EP-SP-020 · GET /supplier/price · auth(supplier) · ?packSizeId=
export const supplierPriceResponse = z.object({
  tierUnitPrice: z.string(),
  tier: z.enum(["bronze", "silver", "gold"])
});
