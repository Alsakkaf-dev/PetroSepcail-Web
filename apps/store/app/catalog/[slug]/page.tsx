import type {
  FamiliesListResponse,
  PackSizesResponse,
  ProductDetailResponse,
  RelatedProductsResponse
} from "@petrospecial/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Banner,
  Breadcrumb,
  ButtonLink,
  Card,
  Cluster,
  Container,
  Gallery,
  Grid,
  Icon,
  Money,
  Page,
  ProductCard,
  Rail,
  Section,
  SectionHead,
  SpecList,
  Stack,
  type SpecRow
} from "@petrospecial/ui";
import { getLocale } from "@petrospecial/app-shell/src/server";
import { count, t, type Locale, type StringKey } from "@petrospecial/i18n";
import { apiGet } from "../../../lib/api";
import { galleryFor, thumbFor } from "../../../lib/productMedia";
import { AddToCartButton } from "../../../components/AddToCartButton";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

function pick(locale: Locale, ar: string, en: string): string {
  return locale === "ar" ? ar : en;
}

/** One of the datasheet's prose blocks: a heading and its paragraphs. */
function ProseBlock({
  id,
  title,
  items,
  locale
}: {
  id: string;
  title: string;
  items: readonly { ar: string; en: string }[];
  locale: Locale;
}) {
  if (items.length === 0) return null;
  return (
    <Section air="app" aria-labelledby={id}>
      <Stack gap="md">
        <SectionHead level={2} titleId={id} title={title} divider={false} />
        <Stack gap="sm">
          {items.map((item) => (
            <p key={item.ar}>{pick(locale, item.ar, item.en)}</p>
          ))}
        </Stack>
      </Stack>
    </Section>
  );
}

export default async function ProductDetailPage({ params, searchParams }: PageProps) {
  const locale = getLocale(searchParams as { lang?: string | string[] });
  const detail = await apiGet<ProductDetailResponse>(`/api/v1/catalog/products/${params.slug}`);
  if (!detail) notFound();

  const [packSizes, related, families] = await Promise.all([
    apiGet<PackSizesResponse>(`/api/v1/catalog/products/${params.slug}/pack-sizes`),
    apiGet<RelatedProductsResponse>(`/api/v1/catalog/products/${params.slug}/related`),
    // Only so a related tile can name its family in words. `special` on
    // screen is a raw enum value, which is a defect.
    apiGet<FamiliesListResponse>("/api/v1/catalog/families")
  ]);

  const familyNames = new Map(families.items.map((f) => [f.code, pick(locale, f.nameAr, f.nameEn)]));

  const name = pick(locale, detail.nameAr, detail.nameEn);
  const specs = detail.specs;

  const images = galleryFor(
    detail.slug,
    detail.media.map((m) => ({ url: m.url }))
  ).map((url, index) => ({
    url,
    // The API's own alt when it has one; otherwise the product name, since
    // "image 2 of 3" tells a screen-reader user nothing about the bottle.
    alt: detail.media[index] ? (pick(locale, detail.media[index]!.altAr ?? name, detail.media[index]!.altEn ?? name)) : name
  }));

  // The ten quick-spec fields (SCR-SF01-003). Nullable ones drop out rather
  // than rendering an empty row — a datasheet with "Compatibility: —" on it
  // reads as missing data, which for these SKUs it is not.
  const specRows: SpecRow[] = [
    { label: t(locale, "product.brand"), value: pick(locale, specs.brandAr, specs.brandEn) },
    ...(specs.line ? [{ label: t(locale, "product.line"), value: specs.line, ltr: true }] : []),
    { label: t(locale, "product.type"), value: pick(locale, specs.typeAr, specs.typeEn) },
    { label: t(locale, "catalog.grade"), value: specs.grade, ltr: true },
    ...(specs.apiService
      ? [{ label: t(locale, "product.apiService"), value: specs.apiService, ltr: true }]
      : []),
    ...(specs.compatibilityAr && specs.compatibilityEn
      ? [{ label: t(locale, "product.compatibility"), value: pick(locale, specs.compatibilityAr, specs.compatibilityEn) }]
      : []),
    ...(specs.drainKm
      ? [{ label: t(locale, "product.drainInterval"), value: t(locale, "product.km", { count: count(specs.drainKm) }), ltr: true }]
      : []),
    ...(specs.packNoteAr && specs.packNoteEn
      ? [{ label: t(locale, "catalog.packSize"), value: pick(locale, specs.packNoteAr, specs.packNoteEn), ltr: true }]
      : []),
    ...(specs.shelfLifeMonths
      ? [
          {
            label: t(locale, "product.shelfLife"),
            value: t(locale, "product.months", { count: count(specs.shelfLifeMonths) })
          }
        ]
      : []),
    { label: t(locale, "product.origin"), value: pick(locale, specs.originAr, specs.originEn) }
  ];

  return (
    <Page width="flush" air="brochure">
      <Section tone="mesh-soft" air="app" aria-labelledby="pdp-title">
        <Container>
          <Stack gap="lg">
            <Breadcrumb
              label={t(locale, "nav.catalog")}
              items={[
                { label: t(locale, "nav.home"), href: "/" },
                { label: t(locale, "catalog.title"), href: "/catalog" },
                { label: name }
              ]}
            />

            {/* Gallery in the main column, buy box in the rail. Source order
                is main-then-rail on desktop and, when it stacks on a phone,
                the buy box lands directly under the pictures rather than
                below seven blocks of datasheet copy. */}
            <Rail
              placement="end"
              rail={
                packSizes && packSizes.items.length > 0 ? (
                  <Card>
                    <Stack gap="md">
                      <p className="ps-eyebrow">{t(locale, "product.packSizes")}</p>
                      <ul className="ps-packs">
                        {packSizes.items.map((pack) => (
                          <li className="ps-packs__row" key={pack.packSizeId}>
                            <span className="ps-packs__size ps-ltr">{pack.sizeLabel}</span>
                            <span className="ps-packs__price">
                              <Money amount={pack.priceInclVat} locale={locale} emphasis="strong" />
                              <span className="ps-packs__vat">{t(locale, "catalog.priceNote")}</span>
                            </span>
                            <Badge variant={pack.inStock ? "success" : "neutral"}>
                              <Icon name={pack.inStock ? "check-circle" : "minus"} size="sm" />
                              {pack.inStock ? t(locale, "catalog.inStock") : t(locale, "catalog.outOfStock")}
                            </Badge>
                            <span className="ps-packs__action">
                              {/* Out of stock disables buying rather than
                                  removing the control, which would leave the
                                  row looking broken. */}
                              <AddToCartButton packSizeId={pack.packSizeId} disabled={!pack.inStock} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Stack>
                  </Card>
                ) : null
              }
            >
              <Stack gap="lg">
                <div>
                  <Cluster gap="sm">
                    <Badge variant="neutral">{pick(locale, specs.brandAr, specs.brandEn)}</Badge>
                    <span className="ps-ltr">{detail.grade}</span>
                  </Cluster>
                  <SectionHead
                    level={1}
                    titleId="pdp-title"
                    title={name}
                    lead={t(locale, `app.${detail.application}` as StringKey)}
                  />
                </div>
                <Gallery
                  images={images}
                  family={detail.family}
                  grade={detail.grade}
                  label={t(locale, "product.gallery")}
                />
              </Stack>
            </Rail>
          </Stack>
        </Container>
      </Section>

      <Container>
        <ProseBlock
          id="pdp-overview"
          title={t(locale, "product.overview")}
          items={detail.blocks.overview}
          locale={locale}
        />

        <Section air="app" aria-labelledby="pdp-specs">
          <Stack gap="md">
            <SectionHead level={2} titleId="pdp-specs" title={t(locale, "product.specs")} divider={false} />
            <SpecList label={t(locale, "product.specs")} rows={specRows} />
          </Stack>
        </Section>

        <ProseBlock
          id="pdp-benefits"
          title={t(locale, "product.benefits")}
          items={detail.blocks.benefits}
          locale={locale}
        />

        <Section air="app" aria-labelledby="pdp-quality">
          <Stack gap="md">
            <SectionHead level={2} titleId="pdp-quality" title={t(locale, "product.quality")} divider={false} />
            <Stack gap="sm">
              {detail.blocks.quality.map((item) => (
                <p key={item.ar}>{pick(locale, item.ar, item.en)}</p>
              ))}
            </Stack>
            {detail.certifications.length > 0 ? (
              <Cluster gap="sm" aria-label={t(locale, "product.certifications")}>
                {detail.certifications.map((certification) => (
                  <Badge key={certification.mark} variant="blue">
                    <Icon name="shield" size="sm" />
                    {pick(locale, certification.captionAr, certification.captionEn)}
                  </Badge>
                ))}
              </Cluster>
            ) : null}
          </Stack>
        </Section>

        <ProseBlock
          id="pdp-manufacturer"
          title={t(locale, "product.manufacturer")}
          items={detail.blocks.manufacturer}
          locale={locale}
        />

        <ProseBlock id="pdp-hse" title={t(locale, "product.hse")} items={detail.blocks.hse} locale={locale} />

        <Section air="app" aria-label={t(locale, "product.wholesaleCta")}>
          <Banner
            tone="info"
            icon="building"
            title={pick(locale, detail.blocks.cta.headingAr, detail.blocks.cta.headingEn)}
            action={
              <ButtonLink href="/catalog" variant="ghost" size="sm">
                {t(locale, "product.wholesaleCta")}
              </ButtonLink>
            }
          >
            {pick(locale, detail.blocks.cta.textAr, detail.blocks.cta.textEn)}
          </Banner>
        </Section>
      </Container>

      {related && related.items.length > 0 ? (
        <Section tone="warm" air="app" aria-labelledby="pdp-related">
          <Container>
            <Stack gap="lg">
              <SectionHead level={2} titleId="pdp-related" title={t(locale, "product.related")} divider={false} />
              <Grid cols="4">
                {related.items.map((item) => (
                  <ProductCard
                    key={item.slug}
                    linkAs={Link}
                    href={`/catalog/${item.slug}`}
                    name={pick(locale, item.nameAr, item.nameEn)}
                    family={item.family}
                    familyLabel={familyNames.get(item.family) ?? item.family}
                    grade={item.grade}
                    thumbSrc={thumbFor(item.slug, item.thumbUrl)}
                    priceLabel={t(locale, "catalog.from")}
                    price={<Money amount={item.fromPriceInclVat} locale={locale} emphasis="strong" />}
                    inStock={item.anyInStock}
                  />
                ))}
              </Grid>
            </Stack>
          </Container>
        </Section>
      ) : null}
    </Page>
  );
}
