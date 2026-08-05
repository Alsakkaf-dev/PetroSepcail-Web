"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ButtonLink,
  Container,
  DataTable,
  DateTime,
  IdDisplay,
  Money,
  Page,
  Section,
  SectionHead,
  Stack
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";

interface PaymentItem {
  paymentId: string;
  invoiceId: string;
  amount: string;
  verifiedAt: string;
}

// SCR-SP05-001 — EP-SP-041. A verified-payments ledger; submitting a new
// transfer proof happens on the invoice it settles, which is where the amount
// and the open balance already are.
//
// Was a raw <table> of two columns with bare amounts and toLocaleDateString().
export default function PaymentsPage() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<PaymentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    authedFetch<{ items: PaymentItem[] }>("/api/v1/supplier/payments?limit=50")
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
      <Section air="app" aria-labelledby="payments-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="payments-title" title={t(locale, "nav.payments")} />

            <DataTable
              caption={t(locale, "nav.payments")}
              state={state}
              stickyHeader
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "supplier.noPayments")}
              emptyDescription={t(locale, "supplier.noPaymentsHint")}
              emptyAction={
                <ButtonLink linkAs={Link} href="/invoices" variant="gold">
                  {t(locale, "nav.invoices")}
                </ButtonLink>
              }
              rows={items ?? []}
              getRowKey={(row) => row.paymentId}
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
                  key: "verifiedAt",
                  header: t(locale, "supplier.verifiedAt"),
                  render: (row) => <DateTime iso={row.verifiedAt} locale={locale} />
                },
                {
                  key: "amount",
                  header: t(locale, "form.amount"),
                  align: "end",
                  render: (row) => <Money amount={row.amount} locale={locale} emphasis="strong" />
                },
                {
                  key: "actions",
                  header: t(locale, "common.showMore"),
                  headerHidden: true,
                  align: "end",
                  render: (row) => (
                    <ButtonLink linkAs={Link} href={`/invoices/${row.invoiceId}`} variant="ghost" size="sm">
                      {t(locale, "nav.invoices")}
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
