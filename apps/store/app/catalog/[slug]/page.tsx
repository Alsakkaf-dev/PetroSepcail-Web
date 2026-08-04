import type { PackSizesResponse, ProductDetailResponse, RelatedProductsResponse } from "@petrospecial/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiGet } from "../../../lib/api";
import { dirFor, otherLocale, t } from "../../../lib/locale";
import { getLocale } from "@petrospecial/app-shell/src/server";
import { AddToCartButton } from "../../../components/AddToCartButton";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}


function BlockList({ items, locale }: { items: Array<{ ar: string; en: string }>; locale: "ar" | "en" }) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>{locale === "ar" ? item.ar : item.en}</li>
      ))}
    </ul>
  );
}

export default async function ProductDetailPage({ params, searchParams }: PageProps) {
  const locale = getLocale(searchParams as { lang?: string | string[] });
  const detail = await apiGet<ProductDetailResponse>(`/api/v1/catalog/products/${params.slug}`);
  if (!detail) notFound();

  const [packSizes, related] = await Promise.all([
    apiGet<PackSizesResponse>(`/api/v1/catalog/products/${params.slug}/pack-sizes`),
    apiGet<RelatedProductsResponse>(`/api/v1/catalog/products/${params.slug}/related`)
  ]);

  const name = locale === "ar" ? detail.nameAr : detail.nameEn;
  const overview = locale === "ar" ? detail.blocks.overview.map((b) => b.ar) : detail.blocks.overview.map((b) => b.en);

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <p style={{ margin: 0 }}>
            <Link href={`/catalog?lang=${locale}`}>{t(locale, "catalog")}</Link>
          </p>
          <h1 style={{ margin: "8px 0", fontFamily: "var(--font-display)" }}>{name}</h1>
        </div>
        <Link href={`/catalog/${params.slug}?lang=${otherLocale(locale)}`}>{t(locale, "switchLang")}</Link>
      </header>

      {detail.media.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 24, overflowX: "auto" }}>
          {detail.media.map((m, i) => (
            // Signed MinIO URLs — not a static-optimizable asset next/image can host.
            <img key={i} src={m.url} alt={(locale === "ar" ? m.altAr : m.altEn) ?? ""} style={{ height: 220, borderRadius: 8 }} />
          ))}
        </div>
      )}

      {packSizes && packSizes.items.length > 0 && (
        <section style={{ marginBottom: 24, padding: 16, background: "var(--bg-warm)", borderRadius: 12 }}>
          {packSizes.items.map((p) => (
            <div key={p.packSizeId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="ps-ltr">{p.sizeLabel}</span>
              <strong className="ps-ltr">
                {p.priceInclVat} {t(locale, "sar")}
              </strong>
              <span style={{ color: p.inStock ? "#1a7f37" : "#b91c1c" }}>
                {p.inStock ? t(locale, "inStock") : t(locale, "outOfStock")}
              </span>
              {p.inStock && <AddToCartButton packSizeId={p.packSizeId} locale={locale} />}
            </div>
          ))}
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        {overview.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>{t(locale, "specs")}</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <th style={{ textAlign: locale === "ar" ? "right" : "left" }}>{t(locale, "packSize")}</th>
              <td className="ps-ltr">{locale === "ar" ? detail.specs.packNoteAr : detail.specs.packNoteEn}</td>
            </tr>
            <tr>
              <th style={{ textAlign: locale === "ar" ? "right" : "left" }} className="ps-ltr">
                Grade
              </th>
              <td className="ps-ltr">{detail.specs.grade}</td>
            </tr>
            {detail.specs.apiService && (
              <tr>
                <th className="ps-ltr" style={{ textAlign: locale === "ar" ? "right" : "left" }}>
                  API
                </th>
                <td className="ps-ltr">{detail.specs.apiService}</td>
              </tr>
            )}
            {detail.specs.drainKm && (
              <tr>
                <th style={{ textAlign: locale === "ar" ? "right" : "left" }}>{locale === "ar" ? "فترة التغيير" : "Drain interval"}</th>
                <td className="ps-ltr">{detail.specs.drainKm} km</td>
              </tr>
            )}
            <tr>
              <th style={{ textAlign: locale === "ar" ? "right" : "left" }}>{locale === "ar" ? "بلد المنشأ" : "Origin"}</th>
              <td>{locale === "ar" ? detail.specs.originAr : detail.specs.originEn}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>{t(locale, "benefits")}</h2>
        <BlockList items={detail.blocks.benefits} locale={locale} />
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>{t(locale, "quality")}</h2>
        <BlockList items={detail.blocks.quality} locale={locale} />
      </section>

      {detail.certifications.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2>{t(locale, "certifications")}</h2>
          <ul>
            {detail.certifications.map((c) => (
              <li key={c.mark}>{locale === "ar" ? c.captionAr : c.captionEn}</li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2>{t(locale, "manufacturer")}</h2>
        <BlockList items={detail.blocks.manufacturer} locale={locale} />
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>{t(locale, "hse")}</h2>
        <BlockList items={detail.blocks.hse} locale={locale} />
      </section>

      {related && related.items.length > 0 && (
        <section>
          <h2>{t(locale, "relatedProducts")}</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {related.items.map((r) => (
              <Link key={r.slug} href={`/catalog/${r.slug}?lang=${locale}`}>
                {locale === "ar" ? r.nameAr : r.nameEn}
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
