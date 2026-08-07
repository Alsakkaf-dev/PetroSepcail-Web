"use client";

import { useCallback, useEffect, useState } from "react";
import type { DriverKpisResponse } from "@petrospecial/contracts";
import {
  Banner,
  Button,
  Container,
  Grid,
  KpiTile,
  Ltr,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, percent, t, type StringKey } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";

interface Tile {
  key: string;
  labelKey: StringKey;
  formulaKey?: StringKey;
  /** A percentage renders with its sign; the average delivery time is minutes
   * and would be nonsense with one. */
  unit: "percent" | "minutes";
  get: (kpis: DriverKpisResponse) => number | null;
}

const TILES: Tile[] = [
  { key: "onTime", labelKey: "driver.kpiOnTime", unit: "percent", get: (k) => k.onTimePct },
  { key: "avgTime", labelKey: "driver.kpiAvgTime", unit: "minutes", get: (k) => k.avgTimeToDeliverMin },
  {
    key: "failed",
    labelKey: "driver.kpiFailed",
    formulaKey: "admin.formulaFailed",
    unit: "percent",
    get: (k) => k.failedPct
  },
  { key: "recon", labelKey: "driver.kpiRecon", unit: "percent", get: (k) => k.reconAccuracyPct },
  { key: "custody", labelKey: "driver.kpiCustody", unit: "percent", get: (k) => k.custodyOnTimePct }
];

// SCR-DL06-002 — a driver's own KPIs, and only their own. EP-DL-080 is
// scoped to the calling driver at the query, so there is no other driver's
// figure this screen could show even by accident; it says so anyway, because
// "how do I compare" is the first question a performance screen provokes.
//
// Four of the five figures come back null today: on-time needs an ETA-versus-
// actual comparison, average time needs an assigned-to-delivered aggregation,
// reconciliation accuracy needs shift variance history, custody timeliness
// needs a collected-to-remitted SLA. The route says so in its own comments.
// A null renders as "not computed yet" and never as a zero — a driver reading
// "0% on time" about themselves would be reading a lie.
export default function KpisPage() {
  const locale = useLocale();
  const [kpis, setKpis] = useState<DriverKpisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<DriverKpisResponse>("/api/v1/driver/kpis")
      .then(setKpis)
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  const show = (tile: Tile, value: number) =>
    tile.unit === "percent" ? percent(locale, value, 1) : t(locale, "driver.minutes", { n: count(value) });

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="kpis-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="kpis-title" title={t(locale, "driver.kpisTitle")} />

            <Banner tone="info" icon="shield">
              {t(locale, "driver.kpisOwnOnly")}
            </Banner>

            {error ? (
              <Banner
                tone="danger"
                action={
                  <Button variant="ghost" size="sm" onClick={load}>
                    {t(locale, "common.retry")}
                  </Button>
                }
              >
                {error}
              </Banner>
            ) : null}

            {kpis === null && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Grid cols="2">
                  <Skeleton variant="block" size="lg" />
                  <Skeleton variant="block" size="lg" />
                  <Skeleton variant="block" size="lg" />
                  <Skeleton variant="block" size="lg" />
                </Grid>
              </div>
            ) : null}

            {kpis ? (
              <Grid cols="2">
                {TILES.map((tile) => {
                  const value = tile.get(kpis);
                  return (
                    <KpiTile
                      key={tile.key}
                      label={t(locale, tile.labelKey)}
                      value={value === null ? "" : <Ltr>{show(tile, value)}</Ltr>}
                      {...(value === null ? { suppressedLabel: t(locale, "driver.kpiNotComputed") } : {})}
                      {...(tile.formulaKey ? { formula: t(locale, tile.formulaKey) } : {})}
                    />
                  );
                })}
              </Grid>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
