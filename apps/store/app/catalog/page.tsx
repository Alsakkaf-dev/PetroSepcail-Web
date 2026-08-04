import type { CatalogProductsResponse, FamiliesListResponse, ProductCard } from "@petrospecial/contracts";
import Link from "next/link";
import { apiGet } from "../../lib/api";
import { dirFor, otherLocale, t } from "../../lib/locale";
import { getLocale } from "@petrospecial/app-shell/src/server";

export const dynamic = "force-dynamic"; // always-fresh catalog reads (no cache-bust plumbing yet — see S07 handover)

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function ProductCardView({ item, locale }: { item: ProductCard; locale: "ar" | "en" }) {
  const name = locale === "ar" ? item.nameAr : item.nameEn;
  return (
    <Link
      href={`/catalog/${item.slug}?lang=${locale}`}
      style={{
        display: "block",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 16,
        background: "var(--surface)",
        textDecoration: "none",
        color: "inherit"
      }}
    >
      <div
        style={{
          height: 140,
          borderRadius: 8,
          marginBottom: 12,
          background: item.thumbUrl ? `center/cover no-repeat url(${item.thumbUrl})` : "var(--bg-warm)",
          display: item.thumbUrl ? undefined : "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: 12
        }}
      >
        {!item.thumbUrl && <span className="ps-ltr">{item.grade}</span>}
      </div>
      <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{name}</p>
      <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: 13 }} className="ps-ltr">
        {item.grade}
      </p>
      <p style={{ margin: 0, fontWeight: 700, color: "var(--blue-600)" }}>
        {t(locale, "from")} <span className="ps-ltr">{item.fromPriceInclVat} {t(locale, "sar")}</span>
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: item.anyInStock ? "#1a7f37" : "#b91c1c" }}>
        {item.anyInStock ? t(locale, "inStock") : t(locale, "outOfStock")}
      </p>
    </Link>
  );
}

export default async function CatalogPage({ searchParams }: PageProps) {
  const locale = getLocale(searchParams as { lang?: string | string[] });
  const family = first(searchParams.family);
  const application = first(searchParams.application);
  const cursor = first(searchParams.cursor);

  const qs = new URLSearchParams();
  if (family) qs.set("family", family);
  if (application) qs.set("application", application);
  if (cursor) qs.set("cursor", cursor);

  const [families, products] = await Promise.all([
    apiGet<FamiliesListResponse>("/api/v1/catalog/families"),
    apiGet<CatalogProductsResponse>(`/api/v1/catalog/products?${qs.toString()}`)
  ]);

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)" }}>{t(locale, "catalog")}</h1>
        <Link href={`/catalog?lang=${otherLocale(locale)}`}>{t(locale, "switchLang")}</Link>
      </header>

      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        <Link
          href={`/catalog?lang=${locale}`}
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: !family ? "var(--gold)" : "transparent",
            textDecoration: "none",
            color: "inherit"
          }}
        >
          {t(locale, "allFamilies")}
        </Link>
        {families.items.map((f) => (
          <Link
            key={f.code}
            href={`/catalog?family=${f.code}&lang=${locale}`}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: `1px solid ${f.colorToken.startsWith("--") ? `var(${f.colorToken})` : f.colorToken}`,
              background: family === f.code ? `var(${f.colorToken})` : "transparent",
              color: family === f.code ? "#fff" : `var(${f.colorToken})`,
              textDecoration: "none",
              fontWeight: 600
            }}
          >
            {locale === "ar" ? f.nameAr : f.nameEn} ({f.skuCount})
          </Link>
        ))}
      </nav>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16
        }}
      >
        {products.items.map((item) => (
          <ProductCardView key={item.slug} item={item} locale={locale} />
        ))}
      </div>

      {products.nextCursor && (
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <Link
            href={`/catalog?${new URLSearchParams({ ...(family ? { family } : {}), cursor: products.nextCursor, lang: locale }).toString()}`}
          >
            {locale === "ar" ? "التالي" : "Next"}
          </Link>
        </div>
      )}
    </main>
  );
}
