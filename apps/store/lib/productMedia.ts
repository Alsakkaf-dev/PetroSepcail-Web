// The four SKUs that have real photography, served from this app's own
// public/products/.
//
// The API's own `thumbUrl` is authoritative and always wins. In practice it is
// null for all twenty-three SKUs in production: the ten seeded media rows
// point at MinIO object keys, MinIO was retired when hosting pivoted to Vercel
// (D-15/ADR-17), and services/api's catalog route deliberately degrades a
// failed presign to null rather than 500-ing the whole listing. So every tile
// in production fell back to the placeholder — which is also why every tile
// was an empty box until the placeholder itself was built.
//
// These are the same photographs the marketing site serves for the same four
// products (assets/img/products/), copied in rather than fetched, so the
// storefront shows a real bottle wherever one has ever been photographed. The
// other nineteen SKUs keep the family/grade placeholder, by design — no
// fabricated imagery (0023_catalog_seed's own note, TC-SF01-007).
//
// See DEFERRED-DECISIONS §4 item 18.
const PHOTOS: Record<string, readonly string[]> = {
  "super-special-10w30": ["/products/10w30-1.webp", "/products/10w30-2.webp", "/products/10w30-3.webp"],
  "super-special-20w50": ["/products/20w50-1.webp", "/products/20w50-2.webp", "/products/20w50-3.webp"],
  "synthetic-special-5w30": ["/products/5w30-1.webp", "/products/5w30-2.webp", "/products/5w30-3.webp"],
  "super-special-diesel-15w40": ["/products/15w40-1.jpg"]
};

/** The tile image for a SKU: the API's, ours, or none (which renders the
 * family/grade placeholder). */
export function thumbFor(slug: string, apiThumbUrl: string | null | undefined): string | null {
  if (apiThumbUrl) return apiThumbUrl;
  return PHOTOS[slug]?.[0] ?? null;
}

/** Every photograph we hold for a SKU, for the datasheet gallery. */
export function galleryFor(slug: string, apiMedia: readonly { url: string }[]): readonly string[] {
  if (apiMedia.length > 0) return apiMedia.map((m) => m.url);
  return PHOTOS[slug] ?? [];
}
