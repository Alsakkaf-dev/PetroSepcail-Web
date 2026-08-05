import type { FamiliesListResponse, ProductCard as ProductCardData, SearchProductsResponse } from "@petrospecial/contracts";
import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Chip,
  Cluster,
  Container,
  EmptyState,
  Grid,
  Icon,
  IconWell,
  Money,
  Page,
  ProductCard,
  Rail,
  Section,
  SectionHead,
  Stack
} from "@petrospecial/ui";
import { getLocale } from "@petrospecial/app-shell/src/server";
import { count, t, type Locale, type StringKey } from "@petrospecial/i18n";
import { apiGet } from "../../lib/api";
import { thumbFor } from "../../lib/productMedia";
import { SearchBox } from "../../components/SearchBox";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// The same four dimensions the catalogue rail offers, because EP-SF-005
// serves the same facet block EP-SF-002 does. A search that cannot be narrowed
// is a search that only works when you already know the exact name.
const DIMENSIONS = [
  { key: "family", labelKey: "catalog.family" },
  { key: "grade", labelKey: "catalog.grade" },
  { key: "application", labelKey: "catalog.application" },
  { key: "packSize", labelKey: "catalog.packSize" }
] as const;

type Dimension = (typeof DIMENSIONS)[number]["key"];

const SORTS = [
  { value: "relevance", labelKey: "search.sortRelevance" },
  { value: "price_asc", labelKey: "search.sortPriceAsc" },
  { value: "price_desc", labelKey: "search.sortPriceDesc" },
  { value: "newest", labelKey: "search.sortNewest" }
] as const;

/** A URL with one thing changed and the cursor dropped. Everything the screen
 * is — the query, every facet, the sort — lives here, which is what makes a
 * search result shareable and what the back button walks through. */
function hrefWith(
  current: Record<string, string | string[] | undefined>,
  changes: Record<string, string | undefined>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    const v = first(value);
    if (v && key !== "cursor" && key !== "lang") params.set(key, v);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

function facetLabel(locale: Locale, dimension: Dimension, value: string, familyNames: Map<string, string>): string {
  if (dimension === "family") return familyNames.get(value) ?? value;
  if (dimension === "application") return t(locale, `app.${value}` as StringKey);
  return value;
}

function familyTone(dimension: Dimension, value: string) {
  if (dimension !== "family") return "neutral" as const;
  return value === "special" || value === "petro" || value === "raval" ? value : ("neutral" as const);
}

// SCR-SF02-001.
//
// Was a bare `<form action="/search">`, an unfaceted grid of two-line cards
// and eight inline styles — with the zero-result state rendering the API's
// `suggestions` array as an unstyled `<ul>` of raw family names.
//
// What it is now: the same server-rendered, URL-driven surface the catalogue
// is, plus the one thing a search genuinely needs that a catalogue does not —
// as-you-type suggestions, which is the single client component here.
export default async function SearchPage({ searchParams }: PageProps) {
  const locale = getLocale(searchParams as { lang?: string | string[] });
  const q = (first(searchParams.q) ?? "").trim();
  const sort = first(searchParams.sort) ?? "relevance";

  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  for (const key of ["family", "grade", "application", "packSize", "inStock", "cursor"]) {
    const value = first(searchParams[key]);
    if (value) qs.set(key, value);
  }
  if (sort !== "relevance") qs.set("sort", sort);

  const [families, results] = await Promise.all([
    apiGet<FamiliesListResponse>("/api/v1/catalog/families"),
    q ? apiGet<SearchProductsResponse>(`/api/v1/catalog/search?${qs.toString()}`) : Promise.resolve(null)
  ]);

  const familyNames = new Map(families.items.map((f) => [f.code, locale === "ar" ? f.nameAr : f.nameEn]));

  const active = DIMENSIONS.flatMap((dimension) => {
    const value = first(searchParams[dimension.key]);
    return value ? [{ dimension: dimension.key, value }] : [];
  });
  const stockOnly = first(searchParams.inStock) === "true";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="search-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="search-title" title={t(locale, "search.title")} />

            <SearchBox initialQuery={q} />

            {!q ? (
              <EmptyState
                illustration={<IconWell name="search" tone="gold" />}
                title={t(locale, "search.startTitle")}
                description={t(locale, "search.startHint")}
                action={
                  <ButtonLink linkAs={Link} href="/catalog" variant="gold">
                    {t(locale, "catalog.browse")}
                  </ButtonLink>
                }
              />
            ) : null}

            {q && results ? (
              <Rail
                rail={
                  <nav aria-label={t(locale, "catalog.filters")}>
                    <Stack gap="md">
                      <p className="ps-eyebrow">{t(locale, "search.sort")}</p>
                      <Cluster gap="sm">
                        {SORTS.map((option) => (
                          <Chip
                            key={option.value}
                            linkAs={Link}
                            href={hrefWith(searchParams, {
                              sort: option.value === "relevance" ? undefined : option.value
                            })}
                            label={t(locale, option.labelKey)}
                            selected={sort === option.value}
                          />
                        ))}
                      </Cluster>

                      <p className="ps-eyebrow">{t(locale, "catalog.filters")}</p>

                      <details className="ps-filter-group" open>
                        <summary className="ps-filter-group__summary">{t(locale, "catalog.inStock")}</summary>
                        <Cluster gap="sm">
                          <Chip
                            linkAs={Link}
                            href={hrefWith(searchParams, { inStock: stockOnly ? undefined : "true" })}
                            label={t(locale, "catalog.stockOnly")}
                            selected={stockOnly}
                          />
                        </Cluster>
                      </details>

                      {DIMENSIONS.map((dimension) => {
                        const values = results.facets[dimension.key];
                        if (values.length === 0) return null;
                        const selected = first(searchParams[dimension.key]);
                        return (
                          <details className="ps-filter-group" key={dimension.key} open>
                            <summary className="ps-filter-group__summary">{t(locale, dimension.labelKey)}</summary>
                            <Cluster gap="sm">
                              {values.map((facet) => {
                                const isSelected = selected === facet.value;
                                return (
                                  <Chip
                                    key={facet.value}
                                    linkAs={Link}
                                    href={hrefWith(searchParams, {
                                      [dimension.key]: isSelected ? undefined : facet.value
                                    })}
                                    label={facetLabel(locale, dimension.key, facet.value, familyNames)}
                                    count={count(facet.count)}
                                    tone={familyTone(dimension.key, facet.value)}
                                    selected={isSelected}
                                  />
                                );
                              })}
                            </Cluster>
                          </details>
                        );
                      })}
                    </Stack>
                  </nav>
                }
              >
                <Stack gap="lg">
                  <SectionHead
                    level={2}
                    title={t(locale, "search.resultsFor", { q })}
                    lead={t(locale, "catalog.resultsCount", { count: count(results.items.length) })}
                    divider={false}
                  />

                  {active.length > 0 || stockOnly ? (
                    <Cluster gap="sm" aria-label={t(locale, "catalog.activeFilters")}>
                      {active.map((filter) => {
                        const label = facetLabel(locale, filter.dimension, filter.value, familyNames);
                        return (
                          <Chip
                            key={`${filter.dimension}:${filter.value}`}
                            linkAs={Link}
                            label={label}
                            removeHref={hrefWith(searchParams, { [filter.dimension]: undefined })}
                            removeLabel={t(locale, "catalog.removeFilter", { label })}
                          />
                        );
                      })}
                      {stockOnly ? (
                        <Chip
                          linkAs={Link}
                          label={t(locale, "catalog.stockOnly")}
                          removeHref={hrefWith(searchParams, { inStock: undefined })}
                          removeLabel={t(locale, "catalog.removeFilter", { label: t(locale, "catalog.stockOnly") })}
                        />
                      ) : null}
                      <ButtonLink
                        linkAs={Link}
                        href={`/search?q=${encodeURIComponent(q)}`}
                        variant="ghost"
                        size="sm"
                      >
                        {t(locale, "common.clearFilters")}
                      </ButtonLink>
                    </Cluster>
                  ) : null}

                  {results.items.length === 0 ? (
                    // The no-match state. The API hands back family names as
                    // its own suggestions; they become real, clickable
                    // searches rather than a bulleted list of words.
                    <EmptyState
                      illustration={<IconWell name="search" tone="gold" />}
                      title={t(locale, "search.noResultsFor", { q })}
                      description={t(locale, "search.tryFamilies")}
                      action={
                        <Cluster gap="sm" justify="center">
                          {families.items.map((family) => (
                            <Chip
                              key={family.code}
                              linkAs={Link}
                              href={`/catalog?family=${family.code}`}
                              label={locale === "ar" ? family.nameAr : family.nameEn}
                              tone={familyTone("family", family.code)}
                            />
                          ))}
                        </Cluster>
                      }
                    />
                  ) : (
                    <Grid cols="3">
                      {results.items.map((item: ProductCardData) => (
                        <ProductCard
                          key={item.slug}
                          linkAs={Link}
                          href={`/catalog/${item.slug}`}
                          name={locale === "ar" ? item.nameAr : item.nameEn}
                          family={item.family}
                          familyLabel={familyNames.get(item.family) ?? item.family}
                          grade={item.grade}
                          thumbSrc={thumbFor(item.slug, item.thumbUrl)}
                          priceLabel={t(locale, "catalog.from")}
                          price={<Money amount={item.fromPriceInclVat} locale={locale} emphasis="strong" />}
                          inStock={item.anyInStock}
                          stock={
                            <Badge variant={item.anyInStock ? "success" : "neutral"}>
                              <Icon name={item.anyInStock ? "check-circle" : "minus"} size="sm" />
                              {item.anyInStock ? t(locale, "catalog.inStock") : t(locale, "catalog.outOfStock")}
                            </Badge>
                          }
                        />
                      ))}
                    </Grid>
                  )}

                  {results.nextCursor ? (
                    <Cluster gap="md" justify="center">
                      <ButtonLink
                        linkAs={Link}
                        href={hrefWith(searchParams, { cursor: results.nextCursor })}
                        variant="ghost"
                      >
                        {t(locale, "catalog.nextPage")}
                      </ButtonLink>
                    </Cluster>
                  ) : null}
                </Stack>
              </Rail>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
