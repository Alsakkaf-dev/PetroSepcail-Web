import { z } from "zod";

// 10-customer-storefront/05-api-specification.md §1 (Catalog & datasheets,
// SF-01/SF-02). This storefront returns BOTH locales in one response body
// (nameAr/nameEn sibling keys, matching PC-07's client-side-toggle i18n
// model — no server-side locale negotiation exists anywhere else in this
// codebase, e.g. pc-notifications.ts/pc-profile.ts); every bilingual field
// here follows that same `<field>Ar`/`<field>En` sibling-key convention.

// EP-SF-001 · GET /catalog/families · public
export const familyItem = z.object({
  code: z.enum(["special", "petro", "raval"]),
  nameAr: z.string(),
  nameEn: z.string(),
  introAr: z.string(),
  introEn: z.string(),
  colorToken: z.string(),
  skuCount: z.number().int().nonnegative()
});
export const familiesListResponse = z.object({ items: z.array(familyItem) });
export type FamiliesListResponse = z.infer<typeof familiesListResponse>;

// Facet shape shared by EP-SF-002 (catalog) and EP-SF-005 (search).
const facetValue = z.object({ value: z.string(), count: z.number().int().nonnegative() });
const facets = z.object({
  family: z.array(facetValue),
  grade: z.array(facetValue),
  application: z.array(facetValue),
  packSize: z.array(facetValue)
});

// Card shape shared by EP-SF-002 (catalog list), EP-SF-005 (search), EP-SF-007 (related).
export const productCard = z.object({
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  family: z.enum(["special", "petro", "raval"]),
  grade: z.string(),
  application: z.enum(["petrol_engine", "diesel_engine", "coolant", "brake_fluid", "gear_fluid"]),
  fromPriceInclVat: z.string(), // money as string decimal (PC-04 convention)
  anyInStock: z.boolean(),
  thumbUrl: z.string().nullable() // null => storefront UI falls back to the family bottle-ph placeholder (TC-SF01-007)
});
export type ProductCard = z.infer<typeof productCard>;

// EP-SF-002 · GET /catalog/products · public
export const catalogProductsResponse = z.object({
  items: z.array(productCard),
  nextCursor: z.string().nullable(),
  facets
});
export type CatalogProductsResponse = z.infer<typeof catalogProductsResponse>;

// EP-SF-005 · GET /catalog/search · public
export const searchProductsResponse = z.object({
  items: z.array(productCard.extend({ matchedOn: z.string() })),
  nextCursor: z.string().nullable(),
  facets,
  suggestions: z.array(z.string()).optional() // present on a zero-result response (FR-SF02-001/007)
});
export type SearchProductsResponse = z.infer<typeof searchProductsResponse>;

// EP-SF-006 · GET /catalog/suggest · public
export const suggestResponse = z.object({
  suggestions: z.array(
    z.object({
      type: z.enum(["sku", "family"]),
      label: z.string(),
      slug: z.string().optional()
    })
  )
});
export type SuggestResponse = z.infer<typeof suggestResponse>;

// EP-SF-003 · GET /catalog/products/{slug} · public
const contentBlockItem = z.object({ ar: z.string(), en: z.string() });
export const productDetailResponse = z.object({
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  family: z.enum(["special", "petro", "raval"]),
  grade: z.string(),
  application: z.enum(["petrol_engine", "diesel_engine", "coolant", "brake_fluid", "gear_fluid"]),
  specs: z.object({
    brandAr: z.string(),
    brandEn: z.string(),
    line: z.string().nullable(),
    typeAr: z.string(),
    typeEn: z.string(),
    grade: z.string(),
    apiService: z.string().nullable(),
    compatibilityAr: z.string().nullable(),
    compatibilityEn: z.string().nullable(),
    drainKm: z.number().int().nullable(),
    packNoteAr: z.string().nullable(),
    packNoteEn: z.string().nullable(),
    shelfLifeMonths: z.number().int().nullable(),
    originAr: z.string(),
    originEn: z.string()
  }),
  blocks: z.object({
    overview: z.array(contentBlockItem),
    benefits: z.array(contentBlockItem),
    quality: z.array(contentBlockItem),
    manufacturer: z.array(contentBlockItem),
    hse: z.array(contentBlockItem),
    cta: z.object({ headingAr: z.string(), headingEn: z.string(), textAr: z.string(), textEn: z.string() })
  }),
  certifications: z.array(
    z.object({
      mark: z.enum(["iso_9001", "api_service", "saso", "saudi_made", "virgin_base_oils", "aramco_spec"]),
      captionAr: z.string(),
      captionEn: z.string()
    })
  ),
  media: z.array(z.object({ url: z.string(), altAr: z.string().nullable(), altEn: z.string().nullable() })),
  rating: z.object({ avg: z.number().nullable(), count: z.number().int().nonnegative() })
});
export type ProductDetailResponse = z.infer<typeof productDetailResponse>;

// EP-SF-004 · GET /catalog/products/{slug}/pack-sizes · public
export const packSizesResponse = z.object({
  items: z.array(
    z.object({
      packSizeId: z.string().uuid(),
      sizeLabel: z.string(),
      sizeLiters: z.string(),
      priceExVat: z.string(),
      vat: z.string(),
      priceInclVat: z.string(),
      inStock: z.boolean() // TC-SF01-016: boolean only, never a quantity
    })
  )
});
export type PackSizesResponse = z.infer<typeof packSizesResponse>;

// EP-SF-007 · GET /catalog/products/{slug}/related · public
export const relatedProductsResponse = z.object({ items: z.array(productCard) });
export type RelatedProductsResponse = z.infer<typeof relatedProductsResponse>;
