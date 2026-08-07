"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Banner,
  Breadcrumb,
  Button,
  Card,
  Cluster,
  Container,
  CopyButton,
  DataTable,
  DateTime,
  IdDisplay,
  Ltr,
  Money,
  Page,
  QrPanel,
  Rail,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  StatusBadge,
  SummaryPanel,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../../lib/authClient";

interface InvoiceListItem {
  invoiceId: string;
  orderId: string;
  status: string;
  total: string;
  openBalance: string;
  issuedAt: string;
  dueAt: string;
  zatcaUuid: string | null;
}
interface InvoiceLine {
  nameAr: string;
  nameEn: string;
  qty: number;
  unitPrice: string;
  vatAmount: string;
  lineTotal: string;
}
interface InvoiceDetail {
  invoice: InvoiceListItem;
  lines: InvoiceLine[];
  qrTlv: string | null;
  deliveryDate: string | null;
}

const SETTLED = new Set(["paid", "written_off"]);

function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("missing required env var NEXT_PUBLIC_API_URL");
  return `${base}${path}`;
}

// EP-SP-033 returns real XML with content-type application/xml. A plain
// <a href> cannot attach the bearer token — the API has been a separate
// origin since D-15 — so it is fetched authenticated and handed to the
// browser as a Blob.
async function downloadUbl(invoiceId: string): Promise<void> {
  const token = window.localStorage.getItem("ps-supplier-token");
  if (!token) return;
  const res = await fetch(apiUrl(`/api/v1/supplier/invoices/${invoiceId}/ubl`), {
    headers: { authorization: `Bearer ${token}` }
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `invoice-${invoiceId}.xml`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// SCR-SP04-001, the detail half — EP-SP-031/033/040.
//
// Was seven inline styles, a raw <table>, the raw status enum, dates through
// toLocaleDateString() and a literal green "pending verification".
//
// The ZATCA QR the spec asks for did not exist at all: `qrTlv` came back in
// the response and nothing rendered it. It is drawn now, with `zatca_uuid`
// written out beside it as the text alternative SP-04 requires — the half
// that survives a photocopy, a screen reader and a phone call to accounts.
export default function InvoiceDetailPage() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [amount, setAmount] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<InvoiceDetail>(`/api/v1/supplier/invoices/${params.id}`)
      .then((res) => {
        setDetail(res);
        setAmount(res.invoice.openBalance);
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale, params.id]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
  }, [load, router]);

  async function submitProof(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // A real proof upload needs EP-PC-050 (media upload-url) and a file
      // picker, which is Phase 8's own work. This path carries the amount and
      // the bank reference, which is the half that already exists.
      await authedFetch(`/api/v1/supplier/invoices/${params.id}/pay-proof`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(amount),
          bankRef,
          proofMediaId: "00000000-0000-0000-0000-000000000000"
        })
      });
      setSubmitted(true);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <Page>
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
        ) : (
          <div role="status" aria-live="polite" aria-busy="true">
            <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
            <Stack gap="md">
              <Skeleton width="1/3" />
              <Skeleton variant="block" size="lg" />
            </Stack>
          </div>
        )}
      </Page>
    );
  }

  const settled = SETTLED.has(detail.invoice.status);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="invoice-title">
        <Container width="wide">
          <Stack gap="lg">
            <Breadcrumb
              label={t(locale, "nav.invoices")}
              items={[
                { label: t(locale, "nav.dashboard"), href: "/dashboard" },
                { label: t(locale, "nav.invoices"), href: "/invoices" },
                { label: t(locale, "supplier.invoiceNumber") }
              ]}
            />

            <SectionHead
              level={1}
              titleId="invoice-title"
              title={t(locale, "supplier.invoiceNumber")}
              lead={
                <IdDisplay
                  id={detail.invoice.invoiceId}
                  copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                />
              }
              actions={
                <Cluster gap="sm">
                  <StatusBadge kind="invoice" value={detail.invoice.status} locale={locale} />
                  {/* A tax invoice gets filed. The print sheet in packages/ui
                      drops the chrome and the pay-proof form and keeps the
                      ZATCA QR whole across a page break. */}
                  <Button variant="dark" size="sm" onClick={() => window.print()}>
                    {t(locale, "common.print")}
                  </Button>
                </Cluster>
              }
            />

            {error ? <Banner tone="danger">{error}</Banner> : null}

            <Rail
              placement="end"
              rail={
                <Stack gap="md">
                  <Card>
                    <SummaryPanel
                      label={t(locale, "cart.summary")}
                      rows={[
                        {
                          id: "issued",
                          label: t(locale, "supplier.issuedAt"),
                          value: <DateTime iso={detail.invoice.issuedAt} locale={locale} />
                        },
                        {
                          id: "due",
                          label: t(locale, "supplier.dueAt"),
                          value: <DateTime iso={detail.invoice.dueAt} locale={locale} />
                        },
                        {
                          id: "total",
                          label: t(locale, "cart.total"),
                          value: <Money amount={detail.invoice.total} locale={locale} />
                        },
                        {
                          id: "open",
                          label: t(locale, "supplier.openBalance"),
                          value: <Money amount={detail.invoice.openBalance} locale={locale} emphasis="strong" />,
                          emphasis: "total" as const
                        }
                      ]}
                    >
                      <Cluster gap="sm">
                        {/* No PDF control. /invoices/{id}/pdf is a documented
                            SPEC-GAP that returns a JSON pointer back to this
                            same endpoint, not PDF bytes — no renderer and no
                            object storage are wired anywhere yet. A button
                            that downloads a JSON file named "invoice.pdf" is
                            worse than no button. */}
                        <Button variant="ghost" size="sm" onClick={() => downloadUbl(detail.invoice.invoiceId)}>
                          {t(locale, "supplier.downloadXml")}
                        </Button>
                      </Cluster>
                    </SummaryPanel>
                  </Card>

                  <QrPanel
                    payload={detail.qrTlv}
                    uuid={detail.invoice.zatcaUuid}
                    title={t(locale, "supplier.qrTitle")}
                    hint={t(locale, "supplier.qrHint")}
                    uuidLabel={t(locale, "supplier.zatcaUuid")}
                    altLabel={t(locale, "supplier.qrTextAlternative")}
                    missingLabel={t(locale, "supplier.qrMissing")}
                    copyControl={
                      detail.invoice.zatcaUuid ? (
                        <CopyButton
                          value={detail.invoice.zatcaUuid}
                          label={t(locale, "common.copy")}
                          copiedLabel={t(locale, "common.copied")}
                        />
                      ) : null
                    }
                  />

                  {/* An issued invoice is never edited — it is corrected by a
                      credit note. Said on the screen, not only in the ledger. */}
                  <Banner tone="info">{t(locale, "supplier.invoiceImmutable")}</Banner>

                  {!settled ? (
                    <Card>
                      {submitted ? (
                        <Banner tone="success">{t(locale, "orders.pendingVerification")}</Banner>
                      ) : (
                        <form onSubmit={submitProof}>
                          <Stack gap="sm">
                            <h2 className="ps-section-head__title">{t(locale, "supplier.payInvoice")}</h2>
                            <TextField
                              label={t(locale, "form.amount")}
                              required
                              forceLtr
                              inputMode="decimal"
                              value={amount}
                              onChange={(event) => setAmount(event.target.value)}
                            />
                            <TextField
                              label={t(locale, "supplier.paymentRef")}
                              required
                              forceLtr
                              value={bankRef}
                              onChange={(event) => setBankRef(event.target.value)}
                            />
                            <Button type="submit" variant="gold" busy={busy}>
                              {t(locale, "orders.uploadProof")}
                            </Button>
                          </Stack>
                        </form>
                      )}
                    </Card>
                  ) : null}
                </Stack>
              }
            >
              <DataTable
                caption={t(locale, "orders.items")}
                rows={detail.lines}
                getRowKey={(row) => `${row.nameEn}-${row.qty}-${row.lineTotal}`}
                columns={[
                  {
                    key: "name",
                    header: t(locale, "orders.items"),
                    emphasis: "primary",
                    render: (row) => (locale === "ar" ? row.nameAr : row.nameEn)
                  },
                  {
                    key: "qty",
                    header: t(locale, "orders.qty"),
                    align: "end",
                    render: (row) => <Ltr>{count(row.qty)}</Ltr>
                  },
                  {
                    key: "unitPrice",
                    header: t(locale, "cart.unitPrice"),
                    align: "end",
                    render: (row) => <Money amount={row.unitPrice} locale={locale} />
                  },
                  {
                    key: "vat",
                    header: t(locale, "cart.vat"),
                    align: "end",
                    render: (row) => <Money amount={row.vatAmount} locale={locale} />
                  },
                  {
                    key: "lineTotal",
                    header: t(locale, "cart.total"),
                    align: "end",
                    render: (row) => <Money amount={row.lineTotal} locale={locale} emphasis="strong" />
                  }
                ]}
              />
            </Rail>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
