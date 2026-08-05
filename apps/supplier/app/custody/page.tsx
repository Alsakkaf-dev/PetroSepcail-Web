"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banner,
  Container,
  DataTable,
  DateTime,
  FinancePanel,
  Grid,
  IdDisplay,
  Ltr,
  Money,
  Page,
  Section,
  SectionHead,
  Stack,
  StatCard
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";

interface CustodyItem {
  custodyRef: string;
  orderId: string;
  amount: string;
  status: "held" | "remitted";
  collectedAt: string;
  remittedAt: string | null;
}
interface CustodyResponse {
  heldTotal: string;
  remittedTotal: string;
  items: CustodyItem[];
}

// SCR-SP05-002 (cash) and SCR-SP05-003 (parcels) — EP-SP-042.
//
// Both are custody, and neither is debt. They get two separate panels on one
// screen rather than one merged list, because "cash you are holding for us"
// and "a customer's parcel you are holding for them" are different objects
// with different obligations — and neither is money you owe.
//
// Was two inline styles, a raw <table>, `status === "held" ? … : …` for the
// state and no separation note anywhere.
export default function CustodyPage() {
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<CustodyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<CustodyResponse>("/api/v1/supplier/custody")
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

  const state = error ? "error" : data === null ? "loading" : data.items.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="custody-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="custody-title" title={t(locale, "nav.custody")} />

            <Grid cols="2">
              <FinancePanel
                kind="custody-funds"
                titleId="custody-cash"
                title={t(locale, "supplier.custodyPanel")}
                subtitle={t(locale, "supplier.custodyPanelSub")}
                separationNote={t(locale, "supplier.custodyNotDebt")}
              >
                <Stack gap="md">
                  <StatCard
                    label={t(locale, "supplier.held")}
                    value={<Money amount={data?.heldTotal ?? "0"} locale={locale} emphasis="strong" />}
                    icon="banknote"
                  />
                  <StatCard
                    label={t(locale, "supplier.remitted")}
                    value={<Money amount={data?.remittedTotal ?? "0"} locale={locale} />}
                    icon="check-circle"
                  />
                </Stack>
              </FinancePanel>

              <FinancePanel
                kind="goods-custody"
                titleId="custody-goods"
                title={t(locale, "supplier.goodsPanel")}
                subtitle={t(locale, "supplier.goodsPanelSub")}
                separationNote={t(locale, "supplier.goodsNotDebt")}
              >
                <Stack gap="md">
                  <StatCard label={t(locale, "supplier.goodsCount")} value={<Ltr>{count(0)}</Ltr>} icon="package" />
                  {/* delivery.v_supplier_pickup_custody is owned by DL-08 and
                      is not built; EP-SP-043 has no data source yet. A bare
                      zero on a panel about parcels somebody is physically
                      holding reads as a fact, so it says what it is. */}
                  <Banner tone="info">{t(locale, "supplier.goodsFeedPending")}</Banner>
                </Stack>
              </FinancePanel>
            </Grid>

            <DataTable
              caption={t(locale, "supplier.custodyPanel")}
              state={state}
              stickyHeader
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "supplier.noCustody")}
              emptyDescription={t(locale, "supplier.noCustodyHint")}
              rows={data?.items ?? []}
              getRowKey={(row) => row.custodyRef}
              columns={[
                {
                  key: "custodyRef",
                  header: t(locale, "supplier.custodyRef"),
                  emphasis: "primary",
                  render: (row) => (
                    <IdDisplay
                      id={row.custodyRef}
                      copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                    />
                  )
                },
                {
                  key: "status",
                  header: t(locale, "form.reason"),
                  render: (row) => (row.status === "held" ? t(locale, "supplier.held") : t(locale, "supplier.remitted"))
                },
                {
                  key: "collectedAt",
                  header: t(locale, "supplier.collectedAt"),
                  render: (row) => <DateTime iso={row.collectedAt} locale={locale} />
                },
                {
                  key: "remittedAt",
                  header: t(locale, "supplier.remittedAt"),
                  render: (row) => (row.remittedAt ? <DateTime iso={row.remittedAt} locale={locale} /> : "—")
                },
                {
                  key: "amount",
                  header: t(locale, "form.amount"),
                  align: "end",
                  render: (row) => <Money amount={row.amount} locale={locale} emphasis="strong" />
                }
              ]}
            />
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
