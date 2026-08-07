"use client";

import { useEffect, useState } from "react";
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
  Skeleton,
  Stack,
  Stagger
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import { getToken } from "../lib/authClient";

// SP-01..09 — the portal's front door. Was a centred black heading and a
// "Sign in" link on a page with no stylesheet reaching it at all.
//
// The three tiles are the portal's actual shape, and they are three rather
// than eleven on purpose: ordering, what you owe, and what you hold in
// custody are different kinds of thing (D-14 rule f), and the landing page is
// the first place that separation should be visible.
export default function SupplierHome() {
  const locale = useLocale();
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
  }, []);

  return (
    <Page air="brochure" width="flush">
      <Section tone="mesh" decor="viscosity" air="brochure" aria-labelledby="supplier-home-title">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="supplier-home-title"
              eyebrow={t(locale, "brand.tagline")}
              title={t(locale, "supplier.title")}
              lead={t(locale, "supplier.homeLead")}
            />
            <Cluster gap="md">
              {signedIn === undefined ? (
                <Skeleton variant="block" size="lg" width="1/3" />
              ) : (
                <ButtonLink
                  linkAs={Link}
                  href={signedIn ? "/dashboard" : "/login"}
                  variant="gold"
                  size="lg"
                >
                  {signedIn ? t(locale, "nav.dashboard") : t(locale, "common.signIn")}
                </ButtonLink>
              )}
            </Cluster>
          </Stack>
        </Container>
      </Section>

      <Section air="app" aria-labelledby="supplier-home-sections">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={2}
              titleId="supplier-home-sections"
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
                title={t(locale, "shell.groupOrdering")}
                description={t(locale, "supplier.homeOrderDesc")}
              />
              <NavTile
                linkAs={Link}
                href="/invoices"
                icon="receipt"
                tone="blue"
                title={t(locale, "shell.groupFinance")}
                description={t(locale, "supplier.homeFinanceDesc")}
              />
              <NavTile
                linkAs={Link}
                href="/custody"
                icon="wallet"
                tone="warn"
                title={t(locale, "nav.custody")}
                description={t(locale, "supplier.homeCustodyDesc")}
              />
            </Stagger>
            </Grid>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
