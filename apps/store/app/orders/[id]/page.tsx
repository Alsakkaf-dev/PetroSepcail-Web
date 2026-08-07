"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Banner,
  Breadcrumb,
  Button,
  ButtonLink,
  Card,
  Cluster,
  Container,
  CopyButton,
  DataList,
  DateTime,
  IdDisplay,
  InlineError,
  Ltr,
  Money,
  Page,
  Rail,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  StatusBadge,
  TextField,
  Timeline
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, statusLabel, t } from "@petrospecial/i18n";
import { authedFetch } from "../../../lib/authClient";

interface OrderDetail {
  orderId: string;
  status: string;
  paymentMethod: "cod" | "bank_transfer";
  total: string;
  codAmount: string | null;
  slot: string;
  lines: Array<{ nameAr: string; nameEn: string; qty: number; lineTotal: string }>;
  payment: { status: string } | null;
  payTo?: { iban: string; holder: string };
  timeline: Array<{ status: string; at: string }>;
}

// SF-05 — FR-SF05-007/006: cancel only before 'preparing'; confirm receipt
// only from 'delivered'. Mirrors the same status set the backend enforces
// (orders.cancel_order/confirm_receipt, db/migrations/0035/0037).
const CANCELLABLE_STATUSES = new Set(["pending_payment", "paid", "confirmed"]);

// SF-07 — a return is only conceivable once the order has arrived. Whether it
// is still inside the seven-day window is EP-SF-050's decision, not this
// file's.
const RETURNABLE_STATUSES = new Set(["delivered", "confirmed_received"]);

// SF-06 — tracking is worth opening from the point the order is a real
// commitment through to the moment it lands. Before payment there is no
// delivery task to track, and after receipt there is nothing left to watch.
const TRACKABLE_STATUSES = new Set(["paid", "confirmed", "preparing", "ready_for_pickup", "out_for_delivery", "delivered"]);

// SCR-SF05-002. The screen that rendered the order's raw UUID as its order
// number, and put "failed" — the literal string — in front of anyone whose
// request errored.
export default function OrderDetailPage() {
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bankRef, setBankRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [proofSubmitted, setProofSubmitted] = useState(false);

  const load = useCallback(() => {
    setError(null);
    authedFetch<OrderDetail>(`/api/v1/orders/${params.id}`)
      .then(setOrder)
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale, params.id]);

  useEffect(load, [load]);

  const act = useCallback(
    async (path: string) => {
      if (!order) return;
      setBusy(true);
      setError(null);
      try {
        const res = await authedFetch<{ status: string }>(`/api/v1/orders/${order.orderId}/${path}`, { method: "POST" });
        setOrder({ ...order, status: res.status });
      } catch (thrown) {
        setError(messageFor(locale, thrown));
      } finally {
        setBusy(false);
      }
    },
    [locale, order]
  );

  const submitProof = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!order) return;
      setBusy(true);
      setError(null);
      try {
        // A real proof upload needs EP-PC-050 (media upload-url) and a file
        // picker, which is SCR-SF04-002's own work in Phase 8. This path
        // carries the bank reference, which is the half that already exists.
        await authedFetch(`/api/v1/orders/${order.orderId}/bank-transfer-proof`, {
          method: "POST",
          body: JSON.stringify({
            amount: order.total,
            bankRef,
            proofMediaId: "00000000-0000-0000-0000-000000000000"
          })
        });
        setProofSubmitted(true);
      } catch (thrown) {
        setError(messageFor(locale, thrown));
      } finally {
        setBusy(false);
      }
    },
    [bankRef, locale, order]
  );

  if (!order) {
    return (
      <Page>
        {error ? (
          <Stack gap="md">
            <Banner tone="danger" action={<Button variant="ghost" size="sm" onClick={load}>{t(locale, "common.retry")}</Button>}>
              {error}
            </Banner>
          </Stack>
        ) : (
          <div role="status" aria-live="polite" aria-busy="true">
            <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
            <Stack gap="md">
              <Skeleton width="1/3" />
              <Skeleton variant="block" size="lg" />
              <Skeleton variant="block" size="lg" />
            </Stack>
          </div>
        )}
      </Page>
    );
  }

  const awaitingProof = order.paymentMethod === "bank_transfer" && order.payTo;
  const proofPending = order.payment?.status === "pending" || proofSubmitted;

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="order-title">
        <Container>
          <Stack gap="lg">
            <Breadcrumb
              label={t(locale, "nav.orders")}
              items={[
                { label: t(locale, "nav.home"), href: "/" },
                { label: t(locale, "orders.title"), href: "/orders" },
                { label: statusLabel("order", locale, order.status) }
              ]}
            />

            <SectionHead
              level={1}
              titleId="order-title"
              title={t(locale, "orders.orderNumber")}
              lead={
                <IdDisplay
                  id={order.orderId}
                  copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                />
              }
              actions={<StatusBadge kind="order" value={order.status} locale={locale} />}
            />

            {error ? <InlineError>{error}</InlineError> : null}

            <Rail placement="end" rail={
              <Stack gap="md">
                <Card>
                  <Stack gap="sm">
                    <p className="ps-eyebrow">{t(locale, "cart.total")}</p>
                    <Money amount={order.total} locale={locale} emphasis="strong" />
                    <p>
                      {t(locale, "orders.paymentMethod")}:{" "}
                      {statusLabel("payment", locale, order.paymentMethod)}
                    </p>
                    {order.paymentMethod === "cod" && order.codAmount ? (
                      <p>
                        {t(locale, "orders.codDue")}: <Money amount={order.codAmount} locale={locale} />
                      </p>
                    ) : null}
                  </Stack>
                </Card>

                <Cluster gap="sm">
                  {/* SCR-SF06-001's entry point. EP-SF-040 has returned an
                      ETA, a driver and a last known position since S13 and
                      this screen linked nowhere, so a customer's only way to
                      know where a delivery was, was to wait for the door.
                      Whether there is anything to track is the tracking
                      screen's own call — it says so plainly when no delivery
                      has been assigned. */}
                  {TRACKABLE_STATUSES.has(order.status) ? (
                    <ButtonLink linkAs={Link} href={`/orders/${order.orderId}/tracking`} variant="ghost">
                      {t(locale, "orders.track")}
                    </ButtonLink>
                  ) : null}
                  {/* An action that is not legal for this status is absent,
                      not disabled: a greyed "Cancel" on a delivered order
                      invites a click that can never work. */}
                  {CANCELLABLE_STATUSES.has(order.status) ? (
                    <Button variant="ghost" busy={busy} onClick={() => act("cancel")}>
                      {t(locale, "orders.cancel")}
                    </Button>
                  ) : null}
                  {order.status === "delivered" ? (
                    <Button variant="gold" busy={busy} onClick={() => act("confirm-receipt")}>
                      {t(locale, "orders.confirmReceipt")}
                    </Button>
                  ) : null}
                  {/* SCR-SF07-001's entry point. The eligibility endpoint has
                      been callable since S13 and nothing in the UI ever
                      reached it, so the return form had no way in. Whether
                      the seven-day window is still open is the server's call,
                      which is why this is a link to the form rather than a
                      decision made here. */}
                  {RETURNABLE_STATUSES.has(order.status) ? (
                    <ButtonLink linkAs={Link} href={`/returns?order=${order.orderId}`} variant="ghost">
                      {t(locale, "orders.requestReturn")}
                    </ButtonLink>
                  ) : null}
                </Cluster>

                {awaitingProof ? (
                  <Card>
                    <Stack gap="md">
                      <p className="ps-eyebrow">{t(locale, "orders.bankTransferTo")}</p>
                      <Stack gap="xs">
                        <span>{t(locale, "orders.iban")}</span>
                        <Cluster gap="sm">
                          {/* An IBAN inside Arabic copy reorders unless it is
                              forced LTR — and a mis-ordered IBAN is a payment
                              sent to nobody. */}
                          <Ltr as="code">{order.payTo!.iban}</Ltr>
                          <CopyButton
                            value={order.payTo!.iban}
                            label={t(locale, "common.copy")}
                            copiedLabel={t(locale, "common.copied")}
                          />
                        </Cluster>
                        <span>
                          {t(locale, "orders.accountHolder")}: {order.payTo!.holder}
                        </span>
                      </Stack>

                      {proofPending ? (
                        <Banner tone="info">{t(locale, "orders.pendingVerification")}</Banner>
                      ) : (
                        <form onSubmit={submitProof}>
                          <Stack gap="sm">
                            <TextField
                              label={t(locale, "orders.bankRef")}
                              value={bankRef}
                              forceLtr
                              required
                              onChange={(e) => setBankRef(e.target.value)}
                            />
                            <Button type="submit" variant="gold" busy={busy}>
                              {t(locale, "orders.uploadProof")}
                            </Button>
                          </Stack>
                        </form>
                      )}
                    </Stack>
                  </Card>
                ) : null}
              </Stack>
            }>
              <Stack gap="lg">
                <Stack gap="md">
                  <h2 className="ps-section-head__title">{t(locale, "orders.items")}</h2>
                  <DataList
                    label={t(locale, "orders.items")}
                    items={order.lines.map((line, index) => ({
                      id: `${index}`,
                      title: locale === "ar" ? line.nameAr : line.nameEn,
                      fields: [
                        { label: t(locale, "orders.qty"), value: <Ltr>{count(line.qty)}</Ltr> },
                        { label: t(locale, "cart.total"), value: <Money amount={line.lineTotal} locale={locale} /> }
                      ]
                    }))}
                  />
                </Stack>

                <Stack gap="md">
                  <h2 className="ps-section-head__title">{t(locale, "orders.timeline")}</h2>
                  <Timeline
                    label={t(locale, "orders.timeline")}
                    entries={order.timeline.map((entry, index) => ({
                      id: `${entry.status}-${index}`,
                      title: statusLabel("order", locale, entry.status),
                      timestamp: <DateTime iso={entry.at} locale={locale} />,
                      tone: index === order.timeline.length - 1 ? "current" : "done"
                    }))}
                  />
                </Stack>
              </Stack>
            </Rail>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
