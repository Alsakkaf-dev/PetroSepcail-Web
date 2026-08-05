"use client";

import type { AdminCustodyResponse, ReceivablesResponse, VerificationQueueResponse } from "@petrospecial/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  AgingBars,
  Banner,
  Button,
  Card,
  Cluster,
  Container,
  DataTable,
  DateTime,
  FinancePanel,
  Grid,
  IdDisplay,
  Money,
  Page,
  Section,
  SectionHead,
  Stack,
  Tabs,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

type Receivable = ReceivablesResponse["items"][number];
type QueueItem = VerificationQueueResponse["items"][number];
type Holder = AdminCustodyResponse["holders"][number];

function share(part: string, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(Number(part) / total, 0), 1);
}

// SCR-AC08-001 and SCR-AC08-002 — AC-08.
//
// Was thirteen inline styles, three raw tables, a heading reading "Custody
// Funds oversight (debt-free view, D-14 rule f)" with the internal rule
// reference printed at an operator, and a literal green status line.
//
// The two rules this screen exists for:
//
//  * Receivables and custody are separate panels, never summed. Verifying a
//    custody remittance changes no figure in receivables, and the queue says
//    so where the verifying happens.
//  * The queue is two visually distinct tabs — bank-transfer proofs and
//    custody remittances — because they settle different obligations and one
//    merged list invites verifying the wrong kind.
function FinanceInner() {
  const locale = useLocale();
  const [receivables, setReceivables] = useState<Receivable[] | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [custody, setCustody] = useState<Holder[] | null>(null);
  const [remitAmounts, setRemitAmounts] = useState<Record<string, string>>({});
  const [writeOffInvoiceId, setWriteOffInvoiceId] = useState("");
  const [writeOffReason, setWriteOffReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [tab, setTab] = useState("bank_transfer");

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      authedFetch<ReceivablesResponse>("/api/v1/admin/finance/receivables"),
      authedFetch<VerificationQueueResponse>("/api/v1/admin/finance/verification-queue"),
      authedFetch<AdminCustodyResponse>("/api/v1/admin/finance/custody")
    ])
      .then(([r, q, c]) => {
        setReceivables(r.items);
        setQueue(q.items);
        setCustody(c.holders);
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  async function verifyBankTransfer(refId: string) {
    setBusy(refId);
    setDone(null);
    try {
      await authedFetch(`/api/v1/admin/finance/bank-transfer/${refId}/verify`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setDone(t(locale, "admin.verifiedOk"));
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  async function verifyRemittance(refId: string, fallback: string) {
    const amount = Number(remitAmounts[refId] ?? fallback);
    if (!amount || amount <= 0) return;
    setBusy(refId);
    setDone(null);
    try {
      await authedFetch(`/api/v1/admin/finance/custody/${refId}/verify-remittance`, {
        method: "POST",
        body: JSON.stringify({ amount })
      });
      setDone(t(locale, "admin.verifiedOk"));
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  async function writeOff(event: React.FormEvent) {
    event.preventDefault();
    setBusy("write-off");
    setDone(null);
    try {
      await authedFetch(`/api/v1/admin/finance/invoices/${writeOffInvoiceId}/write-off`, {
        method: "POST",
        body: JSON.stringify({ reason: writeOffReason })
      });
      setDone(t(locale, "admin.writeOffDone"));
      setWriteOffInvoiceId("");
      setWriteOffReason("");
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  const bankProofs = (queue ?? []).filter((item) => item.kind === "bank_transfer");
  const remittances = (queue ?? []).filter((item) => item.kind === "custody_remittance");
  const visible = tab === "bank_transfer" ? bankProofs : remittances;

  const receivablesState = error
    ? "error"
    : receivables === null
      ? "loading"
      : receivables.length === 0
        ? "empty"
        : "ready";
  const custodyState = error ? "error" : custody === null ? "loading" : custody.length === 0 ? "empty" : "ready";
  const queueState = error ? "error" : queue === null ? "loading" : visible.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="finance-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="finance-title" title={t(locale, "nav.finance")} />

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

            {done ? <Banner tone="success">{done}</Banner> : null}

            {/* Three surfaces, three panels, never one total. */}
            <Grid cols="2">
              <FinancePanel kind="debt" titleId="panel-debt" title={t(locale, "admin.debtPanel")}>
                <DataTable
                  caption={t(locale, "admin.receivables")}
                  state={receivablesState}
                  errorMessage={error ?? undefined}
                  onRetry={load}
                  retryLabel={t(locale, "common.retry")}
                  emptyTitle={t(locale, "admin.receivablesEmpty")}
                  rows={receivables ?? []}
                  getRowKey={(row) => row.supplierId}
                  columns={[
                    {
                      key: "supplier",
                      header: t(locale, "admin.businessName"),
                      emphasis: "primary",
                      // The API returns a supplier id and no name. Never a
                      // raw UUID as a label: IdDisplay truncates it and
                      // carries the full value for copying.
                      render: (row) => (
                        <IdDisplay
                          id={row.supplierId}
                          copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                        />
                      )
                    },
                    {
                      key: "exposure",
                      header: t(locale, "supplier.exposure"),
                      align: "end",
                      render: (row) => <Money amount={row.exposure} locale={locale} emphasis="strong" />
                    },
                    {
                      key: "limit",
                      header: t(locale, "supplier.creditLimit"),
                      align: "end",
                      render: (row) => <Money amount={row.creditLimit} locale={locale} />
                    },
                    {
                      key: "aging",
                      header: t(locale, "supplier.aging"),
                      render: (row) => {
                        const total =
                          Number(row.aging.b0_30) +
                          Number(row.aging.b31_60) +
                          Number(row.aging.b61_90) +
                          Number(row.aging.b90plus);
                        return (
                          <AgingBars
                            label={t(locale, "supplier.aging")}
                            buckets={[
                              {
                                label: t(locale, "supplier.aging0_30"),
                                amount: <Money amount={row.aging.b0_30} locale={locale} />,
                                share: share(row.aging.b0_30, total)
                              },
                              {
                                label: t(locale, "supplier.aging31_60"),
                                amount: <Money amount={row.aging.b31_60} locale={locale} />,
                                share: share(row.aging.b31_60, total)
                              },
                              {
                                label: t(locale, "supplier.aging61_90"),
                                amount: <Money amount={row.aging.b61_90} locale={locale} />,
                                share: share(row.aging.b61_90, total)
                              },
                              {
                                label: t(locale, "supplier.aging90plus"),
                                amount: <Money amount={row.aging.b90plus} locale={locale} />,
                                share: share(row.aging.b90plus, total)
                              }
                            ]}
                          />
                        );
                      }
                    }
                  ]}
                />
              </FinancePanel>

              <FinancePanel
                kind="custody-funds"
                titleId="panel-custody"
                title={t(locale, "admin.custodyPanel")}
                separationNote={t(locale, "admin.custodyNotReceivable")}
              >
                <DataTable
                  caption={t(locale, "admin.custodyOversight")}
                  state={custodyState}
                  errorMessage={error ?? undefined}
                  onRetry={load}
                  retryLabel={t(locale, "common.retry")}
                  emptyTitle={t(locale, "admin.custodyEmpty")}
                  rows={custody ?? []}
                  getRowKey={(row) => `${row.holderKind}-${row.holderId}`}
                  columns={[
                    {
                      key: "holder",
                      header: t(locale, "admin.holder"),
                      emphasis: "primary",
                      render: (row) => (
                        <Cluster gap="sm">
                          <span>
                            {row.holderKind === "driver"
                              ? t(locale, "admin.holderDriver")
                              : t(locale, "admin.holderSupplier")}
                          </span>
                          <IdDisplay
                            id={row.holderId}
                            copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                          />
                        </Cluster>
                      )
                    },
                    {
                      key: "held",
                      header: t(locale, "supplier.held"),
                      align: "end",
                      render: (row) => <Money amount={row.heldTotal} locale={locale} emphasis="strong" />
                    },
                    {
                      key: "remitted",
                      header: t(locale, "supplier.remitted"),
                      align: "end",
                      render: (row) => <Money amount={row.remittedTotal} locale={locale} />
                    }
                  ]}
                />
              </FinancePanel>
            </Grid>

            {/* SCR-AC08-002 — two visually distinct tabs. */}
            <Card>
              <Stack gap="md">
                <h2 className="ps-section-head__title">{t(locale, "admin.verificationQueue")}</h2>
                <Tabs
                  label={t(locale, "admin.verificationQueue")}
                  value={tab}
                  onChange={setTab}
                  items={[
                    { id: "bank_transfer", label: t(locale, "admin.tabBankProofs"), badge: String(bankProofs.length) },
                    {
                      id: "custody_remittance",
                      label: t(locale, "admin.tabCustodyRemittances"),
                      badge: String(remittances.length)
                    }
                  ]}
                >
                  <Stack gap="md">
                    {tab === "custody_remittance" ? (
                      <Banner tone="info">{t(locale, "admin.remittanceNeverTouchesDebt")}</Banner>
                    ) : null}

                    <DataTable
                  caption={t(locale, "admin.verificationQueue")}
                  state={queueState}
                  errorMessage={error ?? undefined}
                  onRetry={load}
                  retryLabel={t(locale, "common.retry")}
                  emptyTitle={t(locale, "admin.queueEmpty")}
                  rows={visible}
                  getRowKey={(row) => row.refId}
                  columns={[
                    {
                      key: "refId",
                      header: t(locale, "supplier.invoiceNumber"),
                      emphasis: "primary",
                      render: (row) => (
                        <IdDisplay
                          id={row.refId}
                          copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                        />
                      )
                    },
                    {
                      key: "submittedAt",
                      header: t(locale, "orders.placedAt"),
                      render: (row) => <DateTime iso={row.submittedAt} locale={locale} />
                    },
                    {
                      key: "submittedBy",
                      header: t(locale, "admin.submittedBy"),
                      render: (row) =>
                        row.submittedBy ? (
                          <IdDisplay
                            id={row.submittedBy}
                            copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                          />
                        ) : (
                          "—"
                        )
                    },
                    {
                      key: "claimedAmount",
                      header: t(locale, "admin.claimedAmount"),
                      align: "end",
                      render: (row) => <Money amount={row.claimedAmount} locale={locale} emphasis="strong" />
                    },
                    {
                      key: "verify",
                      header: t(locale, "admin.verify"),
                      headerHidden: true,
                      align: "end",
                      render: (row) =>
                        row.kind === "bank_transfer" ? (
                          <Button
                            variant="gold"
                            size="sm"
                            busy={busy === row.refId}
                            onClick={() => verifyBankTransfer(row.refId)}
                          >
                            {t(locale, "admin.verify")}
                          </Button>
                        ) : (
                          <Cluster gap="sm" justify="end">
                            {/* A remittance is verified against the amount
                                actually counted, which is not always the
                                amount claimed — so the field is editable and
                                defaults to the claim rather than assuming it. */}
                            <TextField
                              label={t(locale, "admin.remittedAmount")}
                              forceLtr
                              inputMode="decimal"
                              value={remitAmounts[row.refId] ?? row.claimedAmount}
                              onChange={(event) =>
                                setRemitAmounts((prev) => ({ ...prev, [row.refId]: event.target.value }))
                              }
                            />
                            <Button
                              variant="gold"
                              size="sm"
                              busy={busy === row.refId}
                              onClick={() => verifyRemittance(row.refId, row.claimedAmount)}
                            >
                              {t(locale, "admin.verifyRemittance")}
                            </Button>
                          </Cluster>
                        )
                    }
                  ]}
                    />
                  </Stack>
                </Tabs>
              </Stack>
            </Card>

            <Card>
              <form onSubmit={writeOff}>
                <Stack gap="md">
                  <h2 className="ps-section-head__title">{t(locale, "admin.writeOff")}</h2>
                  <TextField
                    label={t(locale, "admin.writeOffInvoice")}
                    required
                    forceLtr
                    value={writeOffInvoiceId}
                    onChange={(event) => setWriteOffInvoiceId(event.target.value)}
                  />
                  <TextField
                    label={t(locale, "form.reason")}
                    required
                    hint={t(locale, "admin.allActionsLogged")}
                    value={writeOffReason}
                    onChange={(event) => setWriteOffReason(event.target.value)}
                  />
                  <Cluster gap="sm">
                    <Button type="submit" variant="danger" busy={busy === "write-off"}>
                      {t(locale, "admin.writeOff")}
                    </Button>
                  </Cluster>
                </Stack>
              </form>
            </Card>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function FinancePage() {
  return (
    <LoginGate>
      <FinanceInner />
    </LoginGate>
  );
}
