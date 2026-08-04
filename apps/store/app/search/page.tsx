import type { SearchProductsResponse } from "@petrospecial/contracts";
import Link from "next/link";
import { apiGet } from "../../lib/api";
import { dirFor, otherLocale, t } from "../../lib/locale";
import { getLocale } from "@petrospecial/app-shell/src/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const locale = getLocale(searchParams as { lang?: string | string[] });
  const q = first(searchParams.q) ?? "";

  const results = q
    ? await apiGet<SearchProductsResponse>(`/api/v1/catalog/search?q=${encodeURIComponent(q)}`)
    : null;

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)" }}>{t(locale, "search")}</h1>
        <Link href={`/search?q=${encodeURIComponent(q)}&lang=${otherLocale(locale)}`}>{t(locale, "switchLang")}</Link>
      </header>

      <form action="/search" method="get" style={{ marginBottom: 24, display: "flex", gap: 8 }}>
        <input type="hidden" name="lang" value={locale} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t(locale, "searchPlaceholder")}
          style={{ flex: 1, padding: 10, border: "1px solid var(--line)", borderRadius: 8 }}
        />
        <button type="submit" style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "var(--gold)" }}>
          {t(locale, "search")}
        </button>
      </form>

      {results && results.items.length === 0 && (
        <div>
          <p>{t(locale, "noResults")}</p>
          <p>{t(locale, "tryAgain")}</p>
          <ul>
            {results.suggestions?.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
          <Link href={`/catalog?lang=${locale}`}>{t(locale, "catalog")}</Link>
        </div>
      )}

      {results && results.items.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
          {results.items.map((item) => (
            <Link
              key={item.slug}
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
              <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{locale === "ar" ? item.nameAr : item.nameEn}</p>
              <p style={{ margin: 0, fontWeight: 700, color: "var(--blue-600)" }} className="ps-ltr">
                {item.fromPriceInclVat} {t(locale, "sar")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
