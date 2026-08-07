"use client";

import type { FleetAlertsResponse, FleetKpisResponse } from "@petrospecial/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Container,
  DataList,
  DataTable,
  IdDisplay,
  Ltr,
  Map,
  Page,
  Section,
  SectionHead,
  Stack
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, percent, t, type StringKey } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

type KpiRow = FleetKpisResponse["rows"][number];
type Alert = FleetAlertsResponse["items"][number];

const SEVERITY_LABEL: Record<string, StringKey> = {
  low: "admin.severityLow",
  medium: "admin.severityMedium",
  high: "admin.severityHigh"
};

const SEVERITY_TONE: Record<string, "neutral" | "warn" | "danger"> = {
  low: "neutral",
  medium: "warn",
  high: "danger"
};

// SCR-AC09-001 — AC-09. KPIs and alerts are real and live; the map is Phase 8
// (MapLibre + OSM per DEFERRED-DECISIONS §3), and it is named as pending here
// rather than left as an unexplained absence.
//
// Was four inline styles, a raw <table>, a bulleted list rendering each alert
// as "[high] custody_open — <uuid>", and percentages as bare numbers.
function FleetInner() {
  const locale = useLocale();
  const [kpis, setKpis] = useState<KpiRow[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      authedFetch<FleetKpisResponse>("/api/v1/admin/fleet/kpis"),
      authedFetch<FleetAlertsResponse>("/api/v1/admin/fleet/alerts")
    ])
      .then(([k, a]) => {
        setKpis(k.rows);
        setAlerts(a.items);
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  const alertsState = error ? "error" : alerts === null ? "loading" : alerts.length === 0 ? "empty" : "ready";
  const kpiState = error ? "error" : kpis === null ? "loading" : kpis.length === 0 ? "empty" : "ready";

  /** A percentage the API may not have — null is "not computed", not zero. */
  const pct = (value: number | null) => (value === null ? "—" : <Ltr>{percent(locale, value, 1)}</Ltr>);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="fleet-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="fleet-title" title={t(locale, "nav.fleet")} />

            <Stack gap="md">
              <h2 className="ps-section-head__title">{t(locale, "admin.fleetMapTitle")}</h2>
              {/* AC-09 asks for a live map. EP-AC-080 mints a realtime channel
                  token and nothing else — there is no REST endpoint anywhere
                  that returns a driver's position, and the Pusher relay the
                  channel belongs to is the one DEFERRED-DECISIONS §3 retires
                  in favour of Supabase Realtime. So the surface is here, keyed
                  off `points`, and the banner names what is missing instead of
                  a grey rectangle implying a feed that never arrives. */}
              <Banner tone="info">{t(locale, "admin.fleetMapNoFeed")}</Banner>
              <Map
                label={t(locale, "admin.fleetMapTitle")}
                points={[]}
                attribution={t(locale, "map.attribution")}
                fallbackLabel={t(locale, "map.places")}
                emptyLabel={t(locale, "map.noPlaces")}
                unavailableLabel={t(locale, "map.unavailable")}
              />
            </Stack>

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

            <Stack gap="md">
              <h2 className="ps-section-head__title">{t(locale, "admin.alerts")}</h2>
              <DataList
                label={t(locale, "admin.alerts")}
                state={alertsState}
                errorMessage={error ?? undefined}
                onRetry={load}
                retryLabel={t(locale, "common.retry")}
                emptyTitle={t(locale, "admin.noAlerts")}
                emptyDescription={t(locale, "admin.noAlertsHint")}
                items={(alerts ?? []).map((alert, index) => ({
                  id: `${alert.kind}-${alert.ref}-${index}`,
                  title: <Ltr>{alert.kind}</Ltr>,
                  status: (
                    <Badge variant={SEVERITY_TONE[alert.severity] ?? "neutral"}>
                      {t(locale, SEVERITY_LABEL[alert.severity] ?? "admin.severityLow")}
                    </Badge>
                  ),
                  fields: [
                    {
                      label: t(locale, "admin.auditResourceId"),
                      value: (
                        <IdDisplay
                          id={alert.ref}
                          copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                        />
                      )
                    }
                  ]
                }))}
              />
            </Stack>

            <Stack gap="md">
              <h2 className="ps-section-head__title">{t(locale, "admin.driverKpis")}</h2>
              <DataTable
                caption={t(locale, "admin.driverKpis")}
                state={kpiState}
                stickyHeader
                errorMessage={error ?? undefined}
                onRetry={load}
                retryLabel={t(locale, "common.retry")}
                emptyTitle={t(locale, "admin.noData")}
                emptyDescription={t(locale, "admin.noDataHint")}
                rows={kpis ?? []}
                getRowKey={(row) => row.driverId}
                columns={[
                  {
                    key: "driver",
                    header: t(locale, "admin.driver"),
                    emphasis: "primary",
                    render: (row) => (
                      <IdDisplay
                        id={row.driverId}
                        copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                      />
                    )
                  },
                  { key: "onTime", header: t(locale, "driver.kpiOnTime"), align: "end", render: (row) => pct(row.onTimePct) },
                  {
                    key: "avgTime",
                    header: t(locale, "driver.kpiAvgTime"),
                    align: "end",
                    render: (row) =>
                      row.avgTimeToDeliverMin === null ? "—" : <Ltr>{String(row.avgTimeToDeliverMin)}</Ltr>
                  },
                  { key: "failed", header: t(locale, "admin.failedPct"), align: "end", render: (row) => pct(row.failedPct) },
                  {
                    key: "recon",
                    header: t(locale, "driver.kpiRecon"),
                    align: "end",
                    render: (row) => pct(row.reconAccuracyPct)
                  },
                  {
                    key: "custody",
                    header: t(locale, "driver.kpiCustody"),
                    align: "end",
                    render: (row) => pct(row.custodyOnTimePct)
                  }
                ]}
              />
            </Stack>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function FleetPage() {
  return (
    <LoginGate>
      <FleetInner />
    </LoginGate>
  );
}
