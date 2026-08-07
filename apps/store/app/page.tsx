import Link from "next/link";
import {
  ButtonLink,
  Cluster,
  Container,
  Grid,
  NavTile,
  Page,
  Section,
  SectionHead,
  Stack,
  Stagger
} from "@petrospecial/ui";
import { getLocale } from "@petrospecial/app-shell/src/server";
import { t } from "@petrospecial/i18n";

// The storefront's front door. Was three inline-styled paragraphs with a
// hardcoded dir="rtl", which meant an English visitor read a left-to-right
// document containing a right-to-left <main>.
//
// A Server Component: nothing here depends on a session, so there is no
// reason to ship it to the browser or to make anyone wait for hydration
// before the first thing they see has a layout.
export default function StoreHome() {
  const locale = getLocale();

  return (
    <Page air="brochure" width="flush">
      <Section tone="mesh" decor="viscosity" air="brochure" aria-labelledby="store-home-title">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="store-home-title"
              eyebrow={t(locale, "brand.tagline")}
              title={t(locale, "catalog.homeTitle")}
              lead={t(locale, "catalog.homeLead")}
            />
            <Cluster gap="md">
              <ButtonLink linkAs={Link} href="/catalog" variant="gold" size="lg">
                {t(locale, "catalog.browse")}
              </ButtonLink>
              <ButtonLink linkAs={Link} href="/search" variant="ghost" size="lg">
                {t(locale, "nav.search")}
              </ButtonLink>
            </Cluster>
          </Stack>
        </Container>
      </Section>

      <Section air="app" aria-labelledby="store-home-sections">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={2}
              titleId="store-home-sections"
              title={t(locale, "shell.sectionNav")}
              divider={false}
            />
            <Grid cols="3">
              {/* The brand entrance, on the one surface in each app that is
                  a front door rather than a workbench. display:contents on
                  Stagger keeps the grid its own layout, and the animation is
                  opacity plus transform, so it costs nothing in CLS. */}
              <Stagger>
              <NavTile
                linkAs={Link}
                href="/catalog"
                icon="droplet"
                title={t(locale, "catalog.title")}
                description={t(locale, "catalog.catalogDesc")}
              />
              <NavTile
                linkAs={Link}
                href="/search"
                icon="search"
                tone="blue"
                title={t(locale, "nav.search")}
                description={t(locale, "catalog.searchDesc")}
              />
              <NavTile
                linkAs={Link}
                href="/orders"
                icon="package"
                title={t(locale, "nav.orders")}
                description={t(locale, "catalog.ordersDesc")}
              />
            </Stagger>
            </Grid>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
