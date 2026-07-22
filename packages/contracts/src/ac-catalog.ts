import { z } from "zod";

// 40-admin-center/05-api-specification.md §2 (Catalog CRUD, AC-02 — sole
// catalog writer). Bilingual fields use the same `<field>Ar`/`<field>En`
// sibling-key convention as sf-catalog.ts (both read/write the same rows).

const contentBlockInput = z.object({ ar: z.string().min(1), en: z.string().min(1) });

// EP-AC-010 · POST/PATCH /admin/catalog/skus · auth(admin)
export const skuUpsertRequest = z.object({
  slug: z.string().min(1),
  familyCode: z.enum(["special", "petro", "raval"]),
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  grade: z.string().min(1),
  application: z.enum(["petrol_engine", "diesel_engine", "coolant", "brake_fluid", "gear_fluid"]),
  line: z.string().nullable().optional(),
  apiService: z.string().nullable().optional(),
  productTypeAr: z.string().min(1),
  productTypeEn: z.string().min(1),
  compatibilityAr: z.string().nullable().optional(),
  compatibilityEn: z.string().nullable().optional(),
  drainKm: z.number().int().nullable().optional(),
  packNoteAr: z.string().nullable().optional(),
  packNoteEn: z.string().nullable().optional(),
  shelfLifeMonths: z.number().int().nullable().optional(),
  isActive: z.boolean().optional(),
  blocks: z
    .object({
      overview: z.array(contentBlockInput),
      benefits: z.array(contentBlockInput),
      quality: z.array(contentBlockInput),
      manufacturer: z.array(contentBlockInput),
      hse: z.array(contentBlockInput),
      cta: z.object({ headingAr: z.string(), headingEn: z.string(), textAr: z.string(), textEn: z.string() })
    })
    .optional() // PATCH may touch only spec fields, leaving content blocks untouched
});
export type SkuUpsertRequest = z.infer<typeof skuUpsertRequest>;

export const skuAdminRow = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  familyCode: z.enum(["special", "petro", "raval"]),
  nameAr: z.string(),
  nameEn: z.string(),
  isActive: z.boolean(),
  updatedAt: z.string().datetime()
});
export const skuUpsertResponse = skuAdminRow;
export type SkuUpsertResponse = z.infer<typeof skuUpsertResponse>;

// EP-AC-011 · POST/PATCH /admin/catalog/pack-sizes · auth(admin)
export const packSizeUpsertRequest = z.object({
  skuId: z.string().uuid(),
  sizeLabel: z.string().min(1),
  sizeLiters: z.number().positive(),
  barcode: z.string().nullable().optional(),
  isActive: z.boolean().optional()
});
export type PackSizeUpsertRequest = z.infer<typeof packSizeUpsertRequest>;

export const packSizeAdminRow = z.object({
  id: z.string().uuid(),
  skuId: z.string().uuid(),
  sizeLabel: z.string(),
  sizeLiters: z.string(),
  isActive: z.boolean()
});
export const packSizeUpsertResponse = packSizeAdminRow;
export type PackSizeUpsertResponse = z.infer<typeof packSizeUpsertResponse>;

// EP-AC-012 · PUT /admin/catalog/prices · auth(admin)
// SPEC-GAP: `tierPrices` (bronze/silver/gold) writes `catalog.tier_prices`,
// a table SP-02 (30-supplier-portal, S14) owns and hasn't been created yet —
// out of this session's scope (S07 = SF-01/SF-02/AC-02 only). Accepted here
// so the contract matches the frozen spec shape, but the route rejects a
// request that actually sets it until SP-02 lands.
export const priceUpdateRequest = z.object({
  packSizeId: z.string().uuid(),
  retailPrice: z.string().optional(),
  tierPrices: z.object({ bronze: z.string(), silver: z.string(), gold: z.string() }).optional()
});
export type PriceUpdateRequest = z.infer<typeof priceUpdateRequest>;

export const priceUpdateResponse = z.object({
  packSizeId: z.string().uuid(),
  retailPrice: z.string(),
  effectiveAt: z.string().datetime()
});
export type PriceUpdateResponse = z.infer<typeof priceUpdateResponse>;

// EP-AC-013 · PUT /admin/catalog/inventory · auth(admin)
export const inventoryUpdateRequest = z.object({
  packSizeId: z.string().uuid(),
  qtyOnHand: z.number().int().nonnegative()
});
export type InventoryUpdateRequest = z.infer<typeof inventoryUpdateRequest>;

export const inventoryUpdateResponse = z.object({
  packSizeId: z.string().uuid(),
  qtyOnHand: z.number().int(),
  reserved: z.number().int()
});
export type InventoryUpdateResponse = z.infer<typeof inventoryUpdateResponse>;

// SPEC-GAP: 40-admin-center/05-api-specification.md §2 defines EP-AC-010..013
// as write-only (no GET) for AC-02 — the admin console still needs a way to
// see current prices/stock before editing them (the console's own DoD:
// "admin can CRUD products"). Additive read endpoint, admin-only, paired
// with EP-AC-012/013 the same way EP-PC-040/041 pairs a GET with its PUT
// (60-platform-core precedent).
export const adminSkuListItem = z.object({
  skuId: z.string().uuid(),
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  isActive: z.boolean(),
  packSizeId: z.string().uuid(),
  sizeLabel: z.string(),
  retailPrice: z.string().nullable(),
  qtyOnHand: z.number().int(),
  reserved: z.number().int()
});
export const adminSkuListResponse = z.object({ items: z.array(adminSkuListItem) });
export type AdminSkuListResponse = z.infer<typeof adminSkuListResponse>;
