"use client";

import type { FulfillmentAnalyticsResponse, SalesAnalyticsResponse } from "@petrospecial/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Card,
  Cluster,
  Container,
  DataTable,
  Grid,
  KpiTile,
  Ltr,
  Money,
  Page,
  Section,
  SectionHead,
  Stack,
  TrendChart
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, dateTime, messageFor, percent, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("missing required env var NEXT_PUBLIC_API_URL");
  return `${base}${path}`;
}

// A plain <a href> cannot attach the bearer token — browsers never send a
// custom Authorization header on anchor navigation, and the API is a separate
// origin with no session cookie to fall back on — so the export is fetched
// authenticated and handed over as a Blob.
async function downloadCsv(): Promise<void> {
  const token = getToken();
  if (!token) return;
  const res = await fetch(apiUrl("/api/v1/admin/analytics/export"), {
    headers: { authorization: `Bearer ${token}` }
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "sales-kpi.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

// SCR-AC01-001 — AC-01. Aggregates only, floored at k≥5; no per-customer row
// ever appears here (NFR-AC-001/002).
//
// Was seven inline styles, a raw <table>, a heading reading "Dashboard — Sales
// & Fulfillment (AC-01)" with the internal spec ID in it, percentages through
// toFixed() and gross amounts as bare numbers with "(SAR)" bolted onto a
// column header.
//
// Every panel carries its own as-of time and its formula, because a dashboard
// figure that cannot be checked is a figure nobody can act on. A null figure
// renders "—" and says it is below the privacy threshold — KpiTile owns that
// rule, so no screen re-decides it and no screen can render the real value
// and then hide it.
function DashboardInner() {
  const locale = useLocale();
  const [sales, setSales] = useState<SalesAnalyticsResponse | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      authedFetch<SalesAnalyticsResponse>("/api/v1/admin/analytics/sales"),
      authedFetch<FulfillmentAnalyticsResponse>("/api/v1/admin/analytics/fulfillment")
    ])
      .then(([salesRes, fulfillmentRes]) => {
        setSales(salesRes);
        setFulfillment(fulfillmentRes);
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  const rows = sales?.rows ?? [];
  const state = error ? "error" : !sales ? "loading" : rows.length === 0 ? "empty" : "ready";
  const asOf = sales ? t(locale, "admin.asOf", { time: dateTime(locale, sales.asOf) }) : undefined;

  // A share of the largest day, for bar length only. Every figure beside a bar
  // is the server's own string.
  const maxGross = rows.reduce((max, row) => Math.max(max, Number(row.gross)), 0);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="dashboard-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="dashboard-title" title={t(locale, "admin.salesTitle")} />

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

            {fulfillment ? (
              <Grid cols="4">
                <KpiTile
                  label={t(locale, "admin.fulfillmentRate")}
                  value={
                    fulfillment.fulfillmentRate !== null ? (
                      <Ltr>{percent(locale, fulfillment.fulfillmentRate, 1)}</Ltr>
                    ) : null
                  }
                  suppressedLabel={
                    fulfillment.fulfillmentRate === null ? t(locale, "state.belowPrivacyThresholdHint") : undefined
                  }
                  asOf={asOf}
                  formula={t(locale, "admin.formulaFulfillment")}
                  tone="success"
                  icon="check-circle"
                />
                <KpiTile
                  label={t(locale, "admin.failedPct")}
                  value={fulfillment.failedPct !== null ? <Ltr>{percent(locale, fulfillment.failedPct, 1)}</Ltr> : null}
                  suppressedLabel={
                    fulfillment.failedPct === null ? t(locale, "state.belowPrivacyThresholdHint") : undefined
                  }
                  asOf={asOf}
                  formula={t(locale, "admin.formulaFailed")}
                  tone="warn"
                  icon="warning"
                />
              </Grid>
            ) : null}

            {rows.length > 0 ? (
              <Card>
                <TrendChart
                  label={t(locale, "admin.salesTrend")}
                  columns={{ label: t(locale, "admin.day"), value: t(locale, "admin.gross") }}
                  points={rows.map((row) => ({
                    label: row.day,
                    share: maxGross > 0 ? Number(row.gross) / maxGross : 0,
                    value: <Money amount={row.gross} locale={locale} />
                  }))}
                />
              </Card>
            ) : null}

            <DataTable
              caption={t(locale, "admin.salesTitle")}
              state={state}
              stickyHeader
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "admin.noData")}
              emptyDescription={t(locale, "admin.noDataHint")}
              rows={rows}
              getRowKey={(row) => `${row.day}-${row.kind}`}
              columns={[
                {
                  key: "day",
                  header: t(locale, "admin.day"),
                  emphasis: "primary",
                  render: (row) => <Ltr>{row.day}</Ltr>
                },
                {
                  key: "kind",
                  header: t(locale, "admin.kind"),
                  render: (row) =>
                    row.kind === "wholesale" ? t(locale, "admin.kindWholesale") : t(locale, "admin.kindRetail")
                },
                {
                  key: "orders",
                  header: t(locale, "admin.orders"),
                  align: "end",
                  render: (row) => <Ltr>{count(row.orders)}</Ltr>
                },
                {
                  key: "buyers",
                  header: t(locale, "admin.buyers"),
                  align: "end",
                  render: (row) => <Ltr>{count(row.buyers)}</Ltr>
                },
                {
                  key: "gross",
                  header: t(locale, "admin.gross"),
                  align: "end",
                  render: (row) => <Money amount={row.gross} locale={locale} emphasis="strong" />
                },
                {
                  key: "discounts",
                  header: t(locale, "admin.discounts"),
                  align: "end",
                  render: (row) => <Money amount={row.discounts} locale={locale} />
                },
                {
                  key: "reversed",
                  header: t(locale, "admin.reversed"),
                  align: "end",
                  render: (row) => <Money amount={row.reversed} locale={locale} />
                }
              ]}
            />

            <Stack gap="sm">
              <Cluster gap="sm">
                <Button variant="ghost" onClick={() => void downloadCsv()}>
                  {t(locale, "admin.exportAggregates")}
                </Button>
              </Cluster>
              <p className="ps-line-note ps-line-note--muted">{t(locale, "admin.exportNote")}</p>
              <p className="ps-line-note ps-line-note--muted">{t(locale, "admin.noCustomerDrilldown")}</p>
            </Stack>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function DashboardPage() {
  return (
    <LoginGate>
      <DashboardInner />
    </LoginGate>
  );
}
