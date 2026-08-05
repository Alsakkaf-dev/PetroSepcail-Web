"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AgingBars,
  Banner,
  Button,
  ButtonLink,
  Cluster,
  Container,
  CreditHeadroom,
  FinancePanel,
  Grid,
  Ltr,
  Money,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  StatCard
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";

interface Aging {
  b0_30: string;
  b31_60: string;
  b61_90: string;
  b90plus: string;
}
interface DashboardResponse {
  debt: { exposure: string; creditLimit: string; headroom: string; aging: Aging; openInvoices: number };
  custodyCash: { heldTotal: string; remittedTotal: string };
  goodsCustody: { count: number };
}

/** A share of the total, for drawing a bar. Not a figure anyone reads — every
 * amount on this screen is the server's own string, verbatim. */
function share(part: string, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(Number(part) / total, 0), 1);
}

// SCR-SP06-001 — EP-SP-052. The D-14 rule (f) centrepiece.
//
// Three panels that are never summed and never merged, and no total-balance
// figure anywhere on the screen. A distributor holding SAR 4,000 of customers'
// cash does not owe SAR 4,000, and one "balance" number would say they did.
//
// What it replaces: three flexbox <section>s with literal #ddd borders, nine
// inline styles, headings that read "Debt" and "Custody cash" with nothing
// between them, `aging` typed in the response and never rendered at all, and
// not one currency symbol on the entire screen — the amounts were bare
// numbers.
//
// FinancePanel enforces the separation through its own types: the two custody
// kinds take `separationNote` as a required prop, so "not part of what you
// owe" cannot be dropped by a refactor.
export default function DashboardPage() {
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<DashboardResponse>("/api/v1/supplier/dashboard")
      .then(setData)
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
  }, [load, router]);

  const agingTotal = data
    ? Number(data.debt.aging.b0_30) +
      Number(data.debt.aging.b31_60) +
      Number(data.debt.aging.b61_90) +
      Number(data.debt.aging.b90plus)
    : 0;
  const limit = data ? Number(data.debt.creditLimit) : 0;
  const usedRatio = data && limit > 0 ? Math.min(Number(data.debt.exposure) / limit, 1) : 0;

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="dashboard-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="dashboard-title" title={t(locale, "nav.dashboard")} />

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

            {!data && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Grid cols="3">
                  <Skeleton variant="block" size="lg" />
                  <Skeleton variant="block" size="lg" />
                  <Skeleton variant="block" size="lg" />
                </Grid>
              </div>
            ) : null}

            {data ? (
              // A grid of three, collapsing to one column on a phone. Each
              // panel keeps its own border, heading and icon at every
              // viewport, which is what stops three stacked panels reading as
              // one running total at 360px.
              <Grid cols="3">
                <FinancePanel
                  kind="debt"
                  titleId="panel-debt"
                  title={t(locale, "supplier.debtPanel")}
                  subtitle={t(locale, "supplier.debtPanelSub")}
                  actions={
                    <ButtonLink linkAs={Link} href="/invoices" variant="ghost" size="sm">
                      {t(locale, "nav.invoices")}
                    </ButtonLink>
                  }
                >
                  <Stack gap="md">
                    <CreditHeadroom
                      limit={<Money amount={data.debt.creditLimit} locale={locale} />}
                      exposure={<Money amount={data.debt.exposure} locale={locale} />}
                      headroom={<Money amount={data.debt.headroom} locale={locale} emphasis="strong" />}
                      usedRatio={usedRatio}
                      labels={{
                        limit: t(locale, "supplier.creditLimit"),
                        exposure: t(locale, "supplier.exposure"),
                        headroom: t(locale, "supplier.headroom"),
                        usage: t(locale, "supplier.creditUsage")
                      }}
                    />

                    <StatCard
                      label={t(locale, "supplier.openInvoices")}
                      value={<Ltr>{count(data.debt.openInvoices)}</Ltr>}
                      icon="receipt"
                    />

                    {/* Typed in the response since S16 and never once drawn.
                        AgingBars reads as a description list with bars on
                        top, so the amounts stay searchable and printable. */}
                    <AgingBars
                      label={t(locale, "supplier.aging")}
                      buckets={[
                        {
                          label: t(locale, "supplier.aging0_30"),
                          amount: <Money amount={data.debt.aging.b0_30} locale={locale} />,
                          share: share(data.debt.aging.b0_30, agingTotal)
                        },
                        {
                          label: t(locale, "supplier.aging31_60"),
                          amount: <Money amount={data.debt.aging.b31_60} locale={locale} />,
                          share: share(data.debt.aging.b31_60, agingTotal)
                        },
                        {
                          label: t(locale, "supplier.aging61_90"),
                          amount: <Money amount={data.debt.aging.b61_90} locale={locale} />,
                          share: share(data.debt.aging.b61_90, agingTotal)
                        },
                        {
                          label: t(locale, "supplier.aging90plus"),
                          amount: <Money amount={data.debt.aging.b90plus} locale={locale} />,
                          share: share(data.debt.aging.b90plus, agingTotal)
                        }
                      ]}
                    />
                  </Stack>
                </FinancePanel>

                <FinancePanel
                  kind="custody-funds"
                  titleId="panel-custody"
                  title={t(locale, "supplier.custodyPanel")}
                  subtitle={t(locale, "supplier.custodyPanelSub")}
                  separationNote={t(locale, "supplier.custodyNotDebt")}
                  actions={
                    <ButtonLink linkAs={Link} href="/custody" variant="ghost" size="sm">
                      {t(locale, "nav.custody")}
                    </ButtonLink>
                  }
                >
                  <Stack gap="md">
                    <StatCard
                      label={t(locale, "supplier.held")}
                      value={<Money amount={data.custodyCash.heldTotal} locale={locale} emphasis="strong" />}
                      icon="banknote"
                    />
                    <StatCard
                      label={t(locale, "supplier.remitted")}
                      value={<Money amount={data.custodyCash.remittedTotal} locale={locale} />}
                      icon="check-circle"
                    />
                  </Stack>
                </FinancePanel>

                <FinancePanel
                  kind="goods-custody"
                  titleId="panel-goods"
                  title={t(locale, "supplier.goodsPanel")}
                  subtitle={t(locale, "supplier.goodsPanelSub")}
                  separationNote={t(locale, "supplier.goodsNotDebt")}
                >
                  <Stack gap="md">
                    <StatCard
                      label={t(locale, "supplier.goodsCount")}
                      value={<Ltr>{count(data.goodsCustody.count)}</Ltr>}
                      icon="package"
                    />
                    {/* EP-SP-043's data source, delivery.v_supplier_pickup_custody,
                        is owned by DL-08 and is not built — the endpoint
                        returns a hard zero and says so in its own comment.
                        A bare "0" on a panel about parcels somebody is
                        physically holding would be read as a fact. */}
                    <Cluster gap="sm">
                      <Banner tone="info">{t(locale, "supplier.goodsFeedPending")}</Banner>
                    </Cluster>
                  </Stack>
                </FinancePanel>
              </Grid>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
