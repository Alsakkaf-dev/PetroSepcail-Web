"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banner,
  ButtonLink,
  Container,
  DataTable,
  DateTime,
  IdDisplay,
  Money,
  Page,
  Section,
  SectionHead,
  Stack,
  StatusBadge
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";

interface InvoiceItem {
  invoiceId: string;
  orderId: string;
  status: string;
  total: string;
  openBalance: string;
  issuedAt: string;
  dueAt: string;
  zatcaUuid: string | null;
}

// SCR-SP04-001, the list half — EP-SP-030. Was a raw <table> printing each
// invoice's raw UUID and its raw status enum, with dates through
// toLocaleDateString() and amounts with no currency at all.
export default function InvoicesPage() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<InvoiceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    authedFetch<{ items: InvoiceItem[] }>("/api/v1/supplier/invoices?limit=50")
      .then((res) => setItems(res.items))
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
  }, [load, router]);

  const state = error ? "error" : items === null ? "loading" : items.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="invoices-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="invoices-title" title={t(locale, "nav.invoices")} />

            <Banner tone="info">{t(locale, "supplier.invoiceImmutable")}</Banner>

            <DataTable
              caption={t(locale, "nav.invoices")}
              state={state}
              stickyHeader
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "supplier.noInvoices")}
              emptyDescription={t(locale, "supplier.noInvoicesHint")}
              emptyAction={
                <ButtonLink linkAs={Link} href="/catalog" variant="gold">
                  {t(locale, "nav.catalog")}
                </ButtonLink>
              }
              rows={items ?? []}
              getRowKey={(row) => row.invoiceId}
              columns={[
                {
                  key: "invoiceId",
                  header: t(locale, "supplier.invoiceNumber"),
                  emphasis: "primary",
                  render: (row) => (
                    <IdDisplay
                      id={row.invoiceId}
                      copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                    />
                  )
                },
                {
                  key: "status",
                  header: t(locale, "supplier.openInvoices"),
                  render: (row) => <StatusBadge kind="invoice" value={row.status} locale={locale} />
                },
                {
                  key: "issuedAt",
                  header: t(locale, "supplier.issuedAt"),
                  render: (row) => <DateTime iso={row.issuedAt} locale={locale} />
                },
                {
                  key: "dueAt",
                  header: t(locale, "supplier.dueAt"),
                  render: (row) => <DateTime iso={row.dueAt} locale={locale} />
                },
                {
                  key: "total",
                  header: t(locale, "cart.total"),
                  align: "end",
                  render: (row) => <Money amount={row.total} locale={locale} />
                },
                {
                  key: "openBalance",
                  header: t(locale, "supplier.openBalance"),
                  align: "end",
                  render: (row) => <Money amount={row.openBalance} locale={locale} emphasis="strong" />
                },
                {
                  key: "actions",
                  header: t(locale, "common.showMore"),
                  headerHidden: true,
                  align: "end",
                  render: (row) => (
                    <ButtonLink linkAs={Link} href={`/invoices/${row.invoiceId}`} variant="ghost" size="sm">
                      {t(locale, "common.showMore")}
                    </ButtonLink>
                  )
                }
              ]}
            />
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
