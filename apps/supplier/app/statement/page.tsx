"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AgingBars,
  Banner,
  Button,
  Card,
  Cluster,
  Container,
  DataTable,
  DateTime,
  IdDisplay,
  Money,
  Page,
  Section,
  SectionHead,
  Stack,
  SummaryPanel,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t, type StringKey } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";

interface StatementLine {
  kind: "invoice" | "payment" | "credit_note";
  refId: string;
  amount: string;
  at: string;
}
interface StatementResponse {
  opening: string;
  invoicesTotal: string;
  paymentsTotal: string;
  creditNotesTotal: string;
  closing: string;
  aging: { b0_30: string; b31_60: string; b61_90: string; b90plus: string };
  lines: StatementLine[];
}

const LINE_KIND: Record<StatementLine["kind"], StringKey> = {
  invoice: "supplier.invoicesTotal",
  payment: "supplier.paymentsTotal",
  credit_note: "supplier.creditNotesTotal"
};

function defaultPeriod(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function share(part: string, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(Number(part) / total, 0), 1);
}

// SCR-SP06-002 — EP-SP-050. Debt only: cash custody has its own screen and is
// never blended in here (D-14 rule f), which is what the standing note under
// the heading says out loud.
//
// Was six inline styles, a raw <table> with the raw ledger `kind` enum in its
// first column, and every amount as a bare number with no currency.
export default function StatementPage() {
  const locale = useLocale();
  const router = useRouter();
  const initial = defaultPeriod();
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [statement, setStatement] = useState<StatementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (!getToken()) {
      router.push("/login");
      return;
    }
    setBusy(true);
    setError(null);
    setRequested(true);
    try {
      setStatement(
        await authedFetch<StatementResponse>(
          `/api/v1/supplier/statement?periodStart=${periodStart}&periodEnd=${periodEnd}`
        )
      );
    } catch (thrown) {
      setError(messageFor(locale, thrown));
      setStatement(null);
    } finally {
      setBusy(false);
    }
  }

  const agingTotal = statement
    ? Number(statement.aging.b0_30) +
      Number(statement.aging.b31_60) +
      Number(statement.aging.b61_90) +
      Number(statement.aging.b90plus)
    : 0;

  const state = error ? "error" : busy ? "loading" : !statement || statement.lines.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="statement-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="statement-title"
              title={t(locale, "nav.statement")}
              lead={t(locale, "supplier.statementDebtOnly")}
              // A statement is filed, not read once. The print sheet in
              // packages/ui strips the chrome and repeats the table headings
              // on every page; this is the way in to it.
              actions={
                <Button variant="dark" size="sm" onClick={() => window.print()}>
                  {t(locale, "common.print")}
                </Button>
              }
            />

            <Card>
              <form onSubmit={generate}>
                <Cluster gap="md" align="end">
                  <TextField
                    label={t(locale, "form.from")}
                    type="date"
                    forceLtr
                    required
                    value={periodStart}
                    onChange={(event) => setPeriodStart(event.target.value)}
                  />
                  <TextField
                    label={t(locale, "form.to")}
                    type="date"
                    forceLtr
                    required
                    value={periodEnd}
                    onChange={(event) => setPeriodEnd(event.target.value)}
                  />
                  <Button type="submit" variant="gold" busy={busy}>
                    {t(locale, "supplier.generateStatement")}
                  </Button>
                </Cluster>
              </form>
            </Card>

            {error ? <Banner tone="danger">{error}</Banner> : null}

            {statement ? (
              <>
                <Card>
                  <SummaryPanel
                    label={t(locale, "nav.statement")}
                    rows={[
                      {
                        id: "opening",
                        label: t(locale, "supplier.opening"),
                        value: <Money amount={statement.opening} locale={locale} />
                      },
                      {
                        id: "invoices",
                        label: t(locale, "supplier.invoicesTotal"),
                        value: <Money amount={statement.invoicesTotal} locale={locale} />
                      },
                      {
                        id: "payments",
                        label: t(locale, "supplier.paymentsTotal"),
                        value: <Money amount={`-${statement.paymentsTotal}`} locale={locale} />,
                        emphasis: "credit" as const
                      },
                      {
                        id: "creditNotes",
                        label: t(locale, "supplier.creditNotesTotal"),
                        value: <Money amount={`-${statement.creditNotesTotal}`} locale={locale} />,
                        emphasis: "credit" as const
                      },
                      {
                        id: "closing",
                        label: t(locale, "supplier.closing"),
                        value: <Money amount={statement.closing} locale={locale} emphasis="strong" />,
                        emphasis: "total" as const
                      }
                    ]}
                  />
                </Card>

                <Card>
                  <Stack gap="md">
                    <h2 className="ps-section-head__title">{t(locale, "supplier.aging")}</h2>
                    <AgingBars
                      label={t(locale, "supplier.aging")}
                      buckets={[
                        {
                          label: t(locale, "supplier.aging0_30"),
                          amount: <Money amount={statement.aging.b0_30} locale={locale} />,
                          share: share(statement.aging.b0_30, agingTotal)
                        },
                        {
                          label: t(locale, "supplier.aging31_60"),
                          amount: <Money amount={statement.aging.b31_60} locale={locale} />,
                          share: share(statement.aging.b31_60, agingTotal)
                        },
                        {
                          label: t(locale, "supplier.aging61_90"),
                          amount: <Money amount={statement.aging.b61_90} locale={locale} />,
                          share: share(statement.aging.b61_90, agingTotal)
                        },
                        {
                          label: t(locale, "supplier.aging90plus"),
                          amount: <Money amount={statement.aging.b90plus} locale={locale} />,
                          share: share(statement.aging.b90plus, agingTotal)
                        }
                      ]}
                    />
                  </Stack>
                </Card>
              </>
            ) : null}

            {requested ? (
              <DataTable
                caption={t(locale, "nav.statement")}
                state={state}
                stickyHeader
                errorMessage={error ?? undefined}
                emptyTitle={t(locale, "supplier.noActivity")}
                emptyDescription={t(locale, "supplier.noActivityHint")}
                rows={statement?.lines ?? []}
                getRowKey={(row) => `${row.kind}-${row.refId}`}
                columns={[
                  {
                    key: "kind",
                    header: t(locale, "form.reason"),
                    emphasis: "primary",
                    // The ledger's own `kind` enum reached the screen raw
                    // before this — "credit_note" in a column headed "Kind".
                    render: (row) => t(locale, LINE_KIND[row.kind])
                  },
                  {
                    key: "refId",
                    header: t(locale, "supplier.invoiceNumber"),
                    render: (row) => (
                      <IdDisplay
                        id={row.refId}
                        copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                      />
                    )
                  },
                  {
                    key: "at",
                    header: t(locale, "orders.placedAt"),
                    render: (row) => <DateTime iso={row.at} locale={locale} />
                  },
                  {
                    key: "amount",
                    header: t(locale, "form.amount"),
                    align: "end",
                    render: (row) => <Money amount={row.amount} locale={locale} emphasis="strong" />
                  }
                ]}
              />
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
