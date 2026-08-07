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

// DL-01/04/07 — the launcher. Was a bare <h1> and a "Sign in" link on an
// unstyled page: the only thing distinguishing driver.petrospecial.com from
// an empty Next.js project was the words.
//
// The primary action depends on whether there is a session, and the session
// lives in localStorage, so it cannot be resolved on the server. `undefined`
// means "not read yet" and renders a placeholder the size of the button that
// replaces it — never a flash of the wrong call to action.
export default function DriverHome() {
  const locale = useLocale();
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
  }, []);

  return (
    <Page air="brochure" width="flush">
      <Section tone="mesh" decor="viscosity" air="brochure" aria-labelledby="driver-home-title">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="driver-home-title"
              eyebrow={t(locale, "brand.tagline")}
              title={t(locale, "driver.title")}
              lead={t(locale, "driver.homeLead")}
            />
            <Cluster gap="md">
              {signedIn === undefined ? (
                <Skeleton variant="block" size="lg" width="1/3" />
              ) : signedIn ? (
                <ButtonLink linkAs={Link} href="/shift" variant="gold" size="lg">
                  {t(locale, "driver.startShift")}
                </ButtonLink>
              ) : (
                <ButtonLink linkAs={Link} href="/login" variant="gold" size="lg">
                  {t(locale, "common.signIn")}
                </ButtonLink>
              )}
            </Cluster>
          </Stack>
        </Container>
      </Section>

      <Section air="app" aria-labelledby="driver-home-sections">
        <Container>
          <Stack gap="lg">
            <SectionHead level={2} titleId="driver-home-sections" title={t(locale, "shell.sectionNav")} divider={false} />
            <Grid cols="3">
              {/* The brand entrance, on the one surface in each app that is
                  a front door rather than a workbench. display:contents on
                  Stagger keeps the grid its own layout, and the animation is
                  opacity plus transform, so it costs nothing in CLS. */}
              <Stagger>
              <NavTile
                linkAs={Link}
                href="/van"
                icon="banknote"
                tone="blue"
                title={t(locale, "driver.vanTitle")}
                description={t(locale, "driver.custodyNotDebt")}
              />
              <NavTile
                linkAs={Link}
                href="/kpis"
                icon="chart"
                title={t(locale, "driver.kpisTitle")}
                description={t(locale, "driver.kpisOwnOnly")}
              />
              <NavTile
                linkAs={Link}
                href="/shift"
                icon="truck"
                title={t(locale, "nav.shift")}
                description={t(locale, "driver.shiftDesc")}
              />
              <NavTile
                linkAs={Link}
                href="/manifest"
                icon="clipboard"
                tone="blue"
                title={t(locale, "nav.manifest")}
                description={t(locale, "driver.manifestDesc")}
              />
              <NavTile
                linkAs={Link}
                href="/audits"
                icon="package"
                title={t(locale, "nav.audits")}
                description={t(locale, "driver.auditsDesc")}
              />
            </Stagger>
            </Grid>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
