import {
  catalogProductsResponse,
  familiesListResponse,
  packSizesResponse,
  productDetailResponse,
  relatedProductsResponse,
  searchProductsResponse,
  suggestResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { getVatRate, money, priceInclVat } from "../catalog/pricing.js";
import { normalizeSearchText } from "../catalog/search.js";
import { withRlsTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import { getMinioClient, toPublicMediaUrl } from "../media/minioClient.js";

const DOWNLOAD_URL_EXPIRY_SECONDS = 3600;
const MEDIA_BUCKET = "ps-media"; // catalog.sku_media only ever stores product_image objects (bucketForPurpose)

interface Filters {
  family?: string;
  grade?: string;
  application?: string;
  packSize?: string;
  priceMin?: number;
  priceMax?: number;
  inStock?: boolean;
  q?: string; // already normalizeSearchText()'d
}

type FacetDim = "family" | "grade" | "application" | "packSize";

interface ProductRow {
  slug: string;
  name_ar: string;
  name_en: string;
  family: string;
  grade: string;
  application: string;
  price_incl_vat: string;
  any_in_stock: boolean;
  thumb_object_key: string | null;
}

function stringParam(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function numberParam(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function boolParam(v: unknown): boolean | undefined {
  return v === "true" ? true : undefined;
}

// Row-level (pre-aggregation) WHERE predicates. `exclude` omits one facet
// dimension's own filter — the standard "facet counts reflect the OTHER
// active filters" technique (TC-SF02-010).
function buildWhere(filters: Filters, exclude: FacetDim | null, params: unknown[]): string {
  const push = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = ["s.is_active"];
  if (filters.family && exclude !== "family") where.push(`f.code = ${push(filters.family)}`);
  if (filters.grade && exclude !== "grade") where.push(`s.grade = ${push(filters.grade)}`);
  if (filters.application && exclude !== "application") where.push(`s.application = ${push(filters.application)}`);
  if (filters.packSize && exclude !== "packSize") where.push(`p.size_label = ${push(filters.packSize)}`);
  if (filters.q) {
    const qParam = push(filters.q);
    where.push(
      `regexp_replace(regexp_replace(lower(s.name_ar || ' ' || s.name_en || ' ' || s.grade || ' ' || f.name_ar || ' ' || f.name_en), '[ً-ْـ]', '', 'g'), '[^a-z0-9؀-ۿ]', '', 'g') like '%' || ${qParam} || '%'`
    );
  }
  return where.join(" and ");
}

// Aggregate-level HAVING predicates: inStock/priceMin/priceMax always apply
// (they aren't among the 4 facet dimensions, so there's no "exclude" case for
// them — unlike buildWhere's row-level filters). vatRate is baked in as a
// bind param too; it's a trusted server-computed number, not user input, so
// ordinary parameterization is enough.
function buildHaving(filters: Filters, vatRate: number, params: unknown[]): string {
  const push = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const having: string[] = [];
  if (filters.inStock) having.push("bool_or(coalesce(a.in_stock, false))");
  if (filters.priceMin !== undefined) {
    having.push(`min(catalog.resolve_retail_price(p.id)) * ${push(1 + vatRate)} >= ${push(filters.priceMin)}`);
  }
  if (filters.priceMax !== undefined) {
    having.push(`min(catalog.resolve_retail_price(p.id)) * ${push(1 + vatRate)} <= ${push(filters.priceMax)}`);
  }
  return having.length ? `having ${having.join(" and ")}` : "";
}

const SORT_EXPR: Record<string, string> = {
  name: "s.name_ar asc",
  price_asc: "min_price asc",
  price_desc: "min_price desc",
  newest: "s.created_at desc",
  relevance: "s.name_ar asc"
};

async function queryProducts(
  client: PoolClient,
  filters: Filters,
  vatRate: number,
  sort: string,
  offset: number,
  limit: number
): Promise<ProductRow[]> {
  const params: unknown[] = [];
  const where = buildWhere(filters, null, params);
  const vatParam = params.push(1 + vatRate);
  const having = buildHaving(filters, vatRate, params);
  const orderBy = SORT_EXPR[sort] ?? SORT_EXPR.name;
  const limitParam = params.push(limit);
  const offsetParam = params.push(offset);

  const sql = `
    select s.slug, s.name_ar, s.name_en, f.code as family, s.grade, s.application,
           (min(catalog.resolve_retail_price(p.id)) * $${vatParam}) as min_price,
           bool_or(coalesce(a.in_stock, false)) as any_in_stock,
           (select m.object_key from catalog.sku_media sm
              join core.media_objects m on m.id = sm.media_id
             where sm.sku_id = s.id order by sm.sort limit 1) as thumb_object_key
    from catalog.skus s
    join catalog.brand_families f on f.id = s.family_id
    join catalog.pack_sizes p on p.sku_id = s.id and p.is_active
    left join catalog.v_sku_availability a on a.pack_size_id = p.id
    where ${where}
    group by s.id, f.code
    ${having}
    order by ${orderBy}
    limit $${limitParam} offset $${offsetParam}
  `;
  const res = await client.query(sql, params);
  return res.rows.map((r) => ({
    slug: r.slug,
    name_ar: r.name_ar,
    name_en: r.name_en,
    family: r.family,
    grade: r.grade,
    application: r.application,
    price_incl_vat: money(Number(r.min_price)),
    any_in_stock: r.any_in_stock,
    thumb_object_key: r.thumb_object_key
  }));
}

async function queryFacet(
  client: PoolClient,
  filters: Filters,
  vatRate: number,
  dimension: FacetDim,
  groupExpr: string
): Promise<Array<{ value: string; count: number }>> {
  const params: unknown[] = [];
  const where = buildWhere(filters, dimension, params);
  const having = buildHaving(filters, vatRate, params);
  const sql = `
    select grp as value, count(*)::int as count
    from (
      select s.id, ${groupExpr} as grp
      from catalog.skus s
      join catalog.brand_families f on f.id = s.family_id
      join catalog.pack_sizes p on p.sku_id = s.id and p.is_active
      left join catalog.v_sku_availability a on a.pack_size_id = p.id
      where ${where}
      group by s.id, f.code, s.grade, s.application, p.size_label
      ${having}
    ) x
    group by grp
    order by grp
  `;
  const res = await client.query<{ value: string; count: number }>(sql, params);
  return res.rows;
}

async function queryAllFacets(client: PoolClient, filters: Filters, vatRate: number) {
  const [family, grade, application, packSize] = await Promise.all([
    queryFacet(client, filters, vatRate, "family", "f.code"),
    queryFacet(client, filters, vatRate, "grade", "s.grade"),
    queryFacet(client, filters, vatRate, "application", "s.application"),
    queryFacet(client, filters, vatRate, "packSize", "p.size_label")
  ]);
  return { family, grade, application, packSize };
}

async function toProductCard(row: ProductRow) {
  let thumbUrl: string | null = null;
  if (row.thumb_object_key) {
    // MinIO is retired from this deployment target (D-15 hosting pivot to
    // Vercel Blob, ADR-17) but media/minioClient.ts hasn't been migrated
    // yet — MINIO_ENDPOINT etc. are unset in production, so this throws for
    // every SKU that has a real photo. Degrade to the same null-thumbUrl
    // placeholder path the storefront already uses for SKUs with no photo
    // at all (TC-SF01-007) rather than letting one broken thumbnail 500 the
    // entire product listing via Promise.all.
    try {
      const signed = await getMinioClient().presignedGetObject(MEDIA_BUCKET, row.thumb_object_key, DOWNLOAD_URL_EXPIRY_SECONDS);
      thumbUrl = toPublicMediaUrl(signed);
    } catch {
      thumbUrl = null;
    }
  }
  return {
    slug: row.slug,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    family: row.family,
    grade: row.grade,
    application: row.application,
    fromPriceInclVat: row.price_incl_vat,
    anyInStock: row.any_in_stock,
    thumbUrl
  };
}

export function registerCatalogRoutes(app: FastifyInstance): void {
  // EP-SF-001 · GET /catalog/families · public
  app.get("/api/v1/catalog/families", async (request, reply) => {
    const rows = await withRlsTransaction(request.ctx.actor, async (client) => {
      const res = await client.query<{
        code: string;
        name_ar: string;
        name_en: string;
        intro_ar: string;
        intro_en: string;
        color_token: string;
        sku_count: number;
      }>(
        `select f.code, f.name_ar, f.name_en, f.intro_ar, f.intro_en, f.color_token,
                count(s.id) filter (where s.is_active)::int as sku_count
         from catalog.brand_families f
         left join catalog.skus s on s.family_id = f.id
         group by f.id
         order by f.sort`
      );
      return res.rows;
    });
    return reply.code(200).send(
      familiesListResponse.parse({
        items: rows.map((r) => ({
          code: r.code,
          nameAr: r.name_ar,
          nameEn: r.name_en,
          introAr: r.intro_ar,
          introEn: r.intro_en,
          colorToken: r.color_token,
          skuCount: r.sku_count
        }))
      })
    );
  });

  function parseFilters(query: Record<string, unknown>, q?: string): Filters {
    return {
      family: stringParam(query.family),
      grade: stringParam(query.grade),
      application: stringParam(query.application),
      packSize: stringParam(query.packSize),
      priceMin: numberParam(query.priceMin),
      priceMax: numberParam(query.priceMax),
      inStock: boolParam(query.inStock),
      q
    };
  }

  // EP-SF-002 · GET /catalog/products · public
  app.get("/api/v1/catalog/products", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { cursor, limit } = parsePagination(query);
    const offset = cursor ? decodeCursor<{ offset: number }>(cursor).offset ?? 0 : 0;
    const filters = parseFilters(query);
    const sort = stringParam(query.sort) ?? "name";

    const vatRate = await getVatRate();
    const { items, facets } = await withRlsTransaction(request.ctx.actor, async (client) => {
      const rows = await queryProducts(client, filters, vatRate, sort, offset, limit + 1);
      const facetCounts = await queryAllFacets(client, filters, vatRate);
      return { items: rows, facets: facetCounts };
    });

    const hasMore = items.length > limit;
    const pageItems = items.slice(0, limit);
    const nextCursor = hasMore ? encodeCursor({ offset: offset + limit }) : null;

    return reply.code(200).send(
      catalogProductsResponse.parse({
        items: await Promise.all(pageItems.map(toProductCard)),
        nextCursor,
        facets
      })
    );
  });

  // EP-SF-005 · GET /catalog/search · public (FR-SF02-001/007)
  app.get("/api/v1/catalog/search", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const qRaw = stringParam(query.q);
    if (!qRaw) throw new ApiError("VALIDATION_ERROR", { field: "q", reason: "required" });
    const q = normalizeSearchText(qRaw);

    const { cursor, limit } = parsePagination(query);
    const offset = cursor ? decodeCursor<{ offset: number }>(cursor).offset ?? 0 : 0;
    const filters = parseFilters(query, q);
    const sort = stringParam(query.sort) ?? "relevance";

    const vatRate = await getVatRate();
    const { items, facets } = await withRlsTransaction(request.ctx.actor, async (client) => {
      const rows = await queryProducts(client, filters, vatRate, sort, offset, limit + 1);
      const facetCounts = await queryAllFacets(client, filters, vatRate);
      return { items: rows, facets: facetCounts };
    });

    const hasMore = items.length > limit;
    const pageItems = items.slice(0, limit);
    const nextCursor = hasMore ? encodeCursor({ offset: offset + limit }) : null;

    let suggestions: string[] | undefined;
    if (pageItems.length === 0) {
      const families = await withRlsTransaction(request.ctx.actor, async (client) => {
        const res = await client.query<{ name_ar: string; name_en: string }>(
          "select name_ar, name_en from catalog.brand_families order by sort"
        );
        return res.rows;
      });
      suggestions = families.flatMap((f) => [f.name_ar, f.name_en]);
    }

    return reply.code(200).send(
      searchProductsResponse.parse({
        items: await Promise.all(
          pageItems.map(async (row) => ({ ...(await toProductCard(row)), matchedOn: "name" }))
        ),
        nextCursor,
        facets,
        ...(suggestions ? { suggestions } : {})
      })
    );
  });

  // EP-SF-006 · GET /catalog/suggest · public
  app.get("/api/v1/catalog/suggest", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const qRaw = stringParam(query.q);
    if (!qRaw || qRaw.length < 2) {
      return reply.code(200).send(suggestResponse.parse({ suggestions: [] }));
    }
    const q = normalizeSearchText(qRaw);

    const rows = await withRlsTransaction(request.ctx.actor, async (client) => {
      const skuRes = await client.query<{ slug: string; name_ar: string; name_en: string }>(
        `select slug, name_ar, name_en from catalog.skus s
         where is_active and regexp_replace(regexp_replace(lower(name_ar || ' ' || name_en), '[ً-ْـ]', '', 'g'), '[^a-z0-9؀-ۿ]', '', 'g') like '%' || $1 || '%'
         order by name_ar limit 5`,
        [q]
      );
      const famRes = await client.query<{ code: string; name_ar: string; name_en: string }>(
        `select code, name_ar, name_en from catalog.brand_families
         where regexp_replace(lower(name_ar || ' ' || name_en), '[^a-z0-9؀-ۿ]', '', 'g') like '%' || $1 || '%'
         order by sort`,
        [q]
      );
      return { skus: skuRes.rows, families: famRes.rows };
    });

    return reply.code(200).send(
      suggestResponse.parse({
        suggestions: [
          ...rows.families.map((f) => ({ type: "family" as const, label: `${f.name_ar} · ${f.name_en}` })),
          ...rows.skus.map((s) => ({ type: "sku" as const, label: `${s.name_ar} · ${s.name_en}`, slug: s.slug }))
        ]
      })
    );
  });

  // EP-SF-003 · GET /catalog/products/{slug} · public
  app.get<{ Params: { slug: string } }>("/api/v1/catalog/products/:slug", async (request, reply) => {
    const { slug } = request.params;
    const detail = await withRlsTransaction(request.ctx.actor, async (client) => {
      const skuRes = await client.query(
        `select s.id, s.slug, s.name_ar, s.name_en, f.code as family, s.grade, s.application,
                f.name_ar as family_name_ar, f.name_en as family_name_en,
                s.line, s.api_service, s.product_type_ar, s.product_type_en,
                s.compatibility_ar, s.compatibility_en, s.drain_km,
                s.pack_note_ar, s.pack_note_en, s.shelf_life_months, s.origin_ar, s.origin_en
         from catalog.skus s join catalog.brand_families f on f.id = s.family_id
         where s.slug = $1 and s.is_active`,
        [slug]
      );
      const sku = skuRes.rows[0];
      if (!sku) return null;

      const [contentRes, certRes, mediaRes, reviewRes] = await Promise.all([
        client.query<{ block: string; ordinal: number; body_ar: string; body_en: string }>(
          "select block, ordinal, body_ar, body_en from catalog.sku_content where sku_id = $1 order by block, ordinal",
          [sku.id]
        ),
        client.query<{ mark: string; caption_ar: string; caption_en: string }>(
          "select mark, caption_ar, caption_en from catalog.certifications where sku_id = $1",
          [sku.id]
        ),
        client.query<{ object_key: string; alt_ar: string | null; alt_en: string | null }>(
          `select m.object_key, sm.alt_ar, sm.alt_en from catalog.sku_media sm
           join core.media_objects m on m.id = sm.media_id
           where sm.sku_id = $1 order by sm.sort`,
          [sku.id]
        ),
        // orders.reviews doesn't exist until S08/SF-08 (S13) — rating is a
        // structural placeholder (0/null) until that schema lands.
        Promise.resolve({ rows: [{ avg: null, count: 0 }] })
      ]);

      const blocksByType = (block: string) =>
        contentRes.rows.filter((r) => r.block === block).map((r) => ({ ar: r.body_ar, en: r.body_en }));
      const ctaRows = contentRes.rows.filter((r) => r.block === "cta");

      return {
        sku,
        blocks: {
          overview: blocksByType("overview"),
          benefits: blocksByType("benefits"),
          quality: blocksByType("quality"),
          manufacturer: blocksByType("manufacturer"),
          hse: blocksByType("hse"),
          cta: {
            headingAr: ctaRows[0]?.body_ar ?? "",
            headingEn: ctaRows[0]?.body_en ?? "",
            textAr: ctaRows[1]?.body_ar ?? "",
            textEn: ctaRows[1]?.body_en ?? ""
          }
        },
        certifications: certRes.rows,
        media: mediaRes.rows,
        rating: reviewRes.rows[0] ?? { avg: null, count: 0 }
      };
    });

    if (!detail) throw new ApiError("NOT_FOUND");
    const { sku, blocks, certifications, media, rating } = detail;

    // Same MinIO-retirement gap as toProductCard() above: skip any photo
    // whose presigned URL can't be generated rather than 500ing the whole
    // page (the contract's media[].url is a required string, so a broken
    // item is dropped, not nulled).
    const mediaWithUrlsSettled = await Promise.allSettled(
      media.map(async (m) => ({
        url: toPublicMediaUrl(await getMinioClient().presignedGetObject(MEDIA_BUCKET, m.object_key, DOWNLOAD_URL_EXPIRY_SECONDS)),
        altAr: m.alt_ar,
        altEn: m.alt_en
      }))
    );
    const mediaWithUrls = mediaWithUrlsSettled
      .filter((r): r is PromiseFulfilledResult<{ url: string; altAr: string | null; altEn: string | null }> => r.status === "fulfilled")
      .map((r) => r.value);

    return reply.code(200).send(
      productDetailResponse.parse({
        slug: sku.slug,
        nameAr: sku.name_ar,
        nameEn: sku.name_en,
        family: sku.family,
        grade: sku.grade,
        application: sku.application,
        specs: {
          brandAr: sku.family_name_ar,
          brandEn: sku.family_name_en,
          line: sku.line,
          typeAr: sku.product_type_ar,
          typeEn: sku.product_type_en,
          grade: sku.grade,
          apiService: sku.api_service,
          compatibilityAr: sku.compatibility_ar,
          compatibilityEn: sku.compatibility_en,
          drainKm: sku.drain_km,
          packNoteAr: sku.pack_note_ar,
          packNoteEn: sku.pack_note_en,
          shelfLifeMonths: sku.shelf_life_months,
          originAr: sku.origin_ar,
          originEn: sku.origin_en
        },
        blocks,
        certifications: certifications.map((c) => ({ mark: c.mark, captionAr: c.caption_ar, captionEn: c.caption_en })),
        media: mediaWithUrls,
        rating: { avg: rating.avg, count: rating.count }
      })
    );
  });

  // EP-SF-004 · GET /catalog/products/{slug}/pack-sizes · public
  app.get<{ Params: { slug: string } }>("/api/v1/catalog/products/:slug/pack-sizes", async (request, reply) => {
    const { slug } = request.params;
    const vatRate = await getVatRate();
    const rows = await withRlsTransaction(request.ctx.actor, async (client) => {
      const res = await client.query<{
        id: string;
        size_label: string;
        size_liters: string;
        list_price: string;
        in_stock: boolean | null;
      }>(
        `select p.id, p.size_label, p.size_liters, catalog.resolve_retail_price(p.id) as list_price,
                a.in_stock
         from catalog.pack_sizes p
         join catalog.skus s on s.id = p.sku_id
         left join catalog.v_sku_availability a on a.pack_size_id = p.id
         where s.slug = $1 and p.is_active
         order by p.size_liters`,
        [slug]
      );
      return res.rows;
    });
    if (rows.length === 0) throw new ApiError("NOT_FOUND");

    return reply.code(200).send(
      packSizesResponse.parse({
        items: rows.map((r) => {
          const exVat = Number(r.list_price);
          const vat = exVat * vatRate;
          return {
            packSizeId: r.id,
            sizeLabel: r.size_label,
            sizeLiters: r.size_liters,
            priceExVat: money(exVat),
            vat: money(vat),
            priceInclVat: priceInclVat(exVat, vatRate),
            inStock: r.in_stock ?? false
          };
        })
      })
    );
  });

  // EP-SF-007 · GET /catalog/products/{slug}/related · public (FR-SF01-008:
  // up to 4, same-family, exclude self and inactive)
  app.get<{ Params: { slug: string } }>("/api/v1/catalog/products/:slug/related", async (request, reply) => {
    const { slug } = request.params;
    const vatRate = await getVatRate();
    const rows = await withRlsTransaction(request.ctx.actor, async (client) => {
      const res = await client.query<ProductRow & { min_price: string }>(
        `select s2.slug, s2.name_ar, s2.name_en, f.code as family, s2.grade, s2.application,
                (min(catalog.resolve_retail_price(p.id)) * $2) as min_price,
                bool_or(coalesce(a.in_stock, false)) as any_in_stock,
                (select m.object_key from catalog.sku_media sm
                   join core.media_objects m on m.id = sm.media_id
                  where sm.sku_id = s2.id order by sm.sort limit 1) as thumb_object_key
         from catalog.skus s1
         join catalog.skus s2 on s2.family_id = s1.family_id and s2.id <> s1.id and s2.is_active
         join catalog.brand_families f on f.id = s2.family_id
         join catalog.pack_sizes p on p.sku_id = s2.id and p.is_active
         left join catalog.v_sku_availability a on a.pack_size_id = p.id
         where s1.slug = $1
         group by s2.id, f.code
         order by s2.name_ar
         limit 4`,
        [slug, 1 + vatRate]
      );
      return res.rows;
    });

    const items = rows.map((r) => ({
      slug: r.slug,
      name_ar: r.name_ar,
      name_en: r.name_en,
      family: r.family,
      grade: r.grade,
      application: r.application,
      price_incl_vat: money(Number(r.min_price)),
      any_in_stock: r.any_in_stock,
      thumb_object_key: r.thumb_object_key
    }));

    return reply.code(200).send(relatedProductsResponse.parse({ items: await Promise.all(items.map(toProductCard)) }));
  });
}
