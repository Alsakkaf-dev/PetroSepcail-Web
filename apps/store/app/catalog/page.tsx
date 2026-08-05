import type { CatalogProductsResponse, FamiliesListResponse, ProductCard as ProductCardData } from "@petrospecial/contracts";
import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Chip,
  Cluster,
  Container,
  EmptyState,
  FamilyCard,
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

export const dynamic = "force-dynamic"; // always-fresh catalog reads (no cache-bust plumbing yet — see S07 handover)

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// The filter dimensions the API actually serves facets for (EP-SF-002).
// priceMin/priceMax are supported by the endpoint but need a range control the
// library does not have yet, so they are deliberately absent rather than
// half-built — see the note in DESIGN-OVERHAUL-PLAN §5.2 (`RangeSlider`).
const DIMENSIONS = [
  { key: "family", labelKey: "catalog.family" },
  { key: "grade", labelKey: "catalog.grade" },
  { key: "application", labelKey: "catalog.application" },
  { key: "packSize", labelKey: "catalog.packSize" }
] as const;

type Dimension = (typeof DIMENSIONS)[number]["key"];

/** A URL with one filter changed and the cursor dropped — page 3 of an old
 * filter is meaningless once the filter changes. */
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
  return qs ? `/catalog?${qs}` : "/catalog";
}

/** Facet values are raw enum strings from the database. `application` has a
 * dictionary entry per value; `grade` and `packSize` are already
 * human-readable (`5W-30`, `1 لتر`) and `family` comes from the families
 * endpoint, which returns both locales. */
function facetLabel(locale: Locale, dimension: Dimension, value: string, familyNames: Map<string, string>): string {
  if (dimension === "family") return familyNames.get(value) ?? value;
  if (dimension === "application") return t(locale, `app.${value}` as StringKey);
  return value;
}

function familyTone(dimension: Dimension, value: string) {
  if (dimension !== "family") return "neutral" as const;
  return value === "special" || value === "petro" || value === "raval" ? value : ("neutral" as const);
}

export default async function CatalogPage({ searchParams }: PageProps) {
  const locale = getLocale(searchParams as { lang?: string | string[] });

  const qs = new URLSearchParams();
  for (const key of ["family", "grade", "application", "packSize", "inStock", "cursor"]) {
    const value = first(searchParams[key]);
    if (value) qs.set(key, value);
  }

  const [families, products] = await Promise.all([
    apiGet<FamiliesListResponse>("/api/v1/catalog/families"),
    apiGet<CatalogProductsResponse>(`/api/v1/catalog/products?${qs.toString()}`)
  ]);

  const familyNames = new Map(families.items.map((f) => [f.code, locale === "ar" ? f.nameAr : f.nameEn]));

  const active = DIMENSIONS.flatMap((dimension) => {
    const value = first(searchParams[dimension.key]);
    return value ? [{ dimension: dimension.key, value }] : [];
  });
  const stockOnly = first(searchParams.inStock) === "true";
  const filtered = active.length > 0 || stockOnly;

  return (
    <Page width="flush" air="brochure">
      {/* The landing (SCR-SF01-001) and the listing (SCR-SF01-002) share this
          route. The hero and the family cards are the landing; they stand down
          once a filter is on, because at that point the screen is a result set
          and everything above it is in the way. */}
      {!filtered ? (
        <>
          <Section tone="mesh" decor="viscosity" air="brochure" aria-labelledby="catalog-title">
            <Container>
              <SectionHead
                level={1}
                titleId="catalog-title"
                eyebrow={t(locale, "brand.tagline")}
                title={t(locale, "catalog.landingTitle")}
                lead={t(locale, "catalog.landingLead")}
              />
            </Container>
          </Section>

          <Section air="app" aria-labelledby="catalog-families">
            <Container>
              <Stack gap="lg">
                <SectionHead
                  level={2}
                  titleId="catalog-families"
                  title={t(locale, "catalog.familiesHeading")}
                  divider={false}
                />
                <Grid cols="3">
                  {families.items.map((family) => (
                    <FamilyCard
                      key={family.code}
                      linkAs={Link}
                      href={hrefWith(searchParams, { family: family.code })}
                      family={family.code}
                      name={locale === "ar" ? family.nameAr : family.nameEn}
                      intro={locale === "ar" ? family.introAr : family.introEn}
                      skuCount={count(family.skuCount)}
                      skuCountLabel={t(locale, "catalog.skuCountLabel")}
                    />
                  ))}
                </Grid>
              </Stack>
            </Container>
          </Section>
        </>
      ) : null}

      <Section tone={filtered ? "plain" : "warm"} air="app" aria-labelledby="catalog-results">
        <Container>
          <Rail
            rail={
              <nav aria-label={t(locale, "catalog.filters")}>
                <Stack gap="md">
                  <p className="ps-eyebrow">{t(locale, "catalog.filters")}</p>

                  {/* <details> rather than a bottom sheet: the rail stacks above
                      the results on a phone, and collapsed groups keep the
                      first product within a thumb's reach. It needs no
                      JavaScript, so it works in the server-rendered HTML and
                      survives with the keyboard. */}
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
                    const values = products.facets[dimension.key];
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
                titleId="catalog-results"
                title={filtered ? t(locale, "catalog.title") : t(locale, "catalog.allProducts")}
                lead={t(locale, "catalog.resultsCount", { count: count(products.items.length) })}
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
                  <ButtonLink linkAs={Link} href="/catalog" variant="ghost" size="sm">
                    {t(locale, "common.clearFilters")}
                  </ButtonLink>
                </Cluster>
              ) : null}

              {products.items.length === 0 ? (
                <EmptyState
                  illustration={<IconWell name="search" tone="gold" />}
                  title={t(locale, "catalog.noResults")}
                  description={t(locale, "catalog.noResultsHint")}
                  action={
                    <ButtonLink linkAs={Link} href="/catalog" variant="gold">
                      {t(locale, "common.clearFilters")}
                    </ButtonLink>
                  }
                />
              ) : (
                <Grid cols="3">
                  {products.items.map((item: ProductCardData) => (
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
                      // Availability is not a D-04 status, so it does not go
                      // through StatusBadge — but it still carries a glyph, so
                      // "in stock" and "out of stock" never differ by colour
                      // alone.
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

              {products.nextCursor ? (
                <Cluster gap="md" justify="center">
                  <ButtonLink
                    linkAs={Link}
                    href={hrefWith(searchParams, { cursor: products.nextCursor })}
                    variant="ghost"
                  >
                    {t(locale, "catalog.nextPage")}
                  </ButtonLink>
                </Cluster>
              ) : null}
            </Stack>
          </Rail>
        </Container>
      </Section>
    </Page>
  );
}
