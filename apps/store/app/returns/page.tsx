"use client";

import type { ReturnListResponse } from "@petrospecial/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Cluster,
  Container,
  DataList,
  DateTime,
  IdDisplay,
  LineItem,
  LineList,
  LineNote,
  Page,
  QtyStepper,
  RadioGroup,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  StatusBadge,
  Textarea,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, date, messageFor, t, type StringKey } from "@petrospecial/i18n";
import { LoginForm } from "../../components/LoginForm";
import { authedFetch, getToken, isSessionEnded } from "../../lib/authClient";

// `useSearchParams()` below reads `?order=<id>`, which is a genuine URL read
// rather than the locale plumbing the <Suspense> + PageInner() wrappers used
// to exist for. Declaring the route dynamic is what satisfies the App
// Router's prerender rule without putting a null-fallback boundary back.
export const dynamic = "force-dynamic";

interface Eligibility {
  eligible: boolean;
  windowClosesAt: string | null;
  lines: Array<{ orderLineId: string; slug: string; qtyEligible: number }>;
}

interface LineChoice {
  selected: boolean;
  qty: number;
  unopened: boolean;
}

/** EP-SF-054. Cash-on-delivery refunds have nowhere to go back to, so an
 * approved return asks for an IBAN — forced LTR, because a mis-ordered IBAN
 * is a refund sent to nobody. */
function RefundIban({ returnId }: { returnId: string }) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [iban, setIban] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/api/v1/returns/${returnId}/refund-iban`, {
        method: "POST",
        body: JSON.stringify({ iban: iban.replace(/\s+/g, "") })
      });
      setDone(true);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <LineNote tone="info">{t(locale, "returns.refundIbanSaved")}</LineNote>;
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t(locale, "returns.refundIban")}
      </Button>
    );
  }

  return (
    <form onSubmit={save}>
      <Stack gap="sm">
        <TextField
          label={t(locale, "returns.refundIban")}
          hint={t(locale, "returns.refundIbanHint")}
          error={error ?? undefined}
          forceLtr
          required
          autoComplete="off"
          value={iban}
          onChange={(event) => setIban(event.target.value)}
        />
        <Cluster gap="sm">
          <Button type="submit" variant="gold" size="sm" busy={busy}>
            {t(locale, "common.save")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {t(locale, "common.cancel")}
          </Button>
        </Cluster>
      </Stack>
    </form>
  );
}

const REASONS = [
  { value: "wrong_item", labelKey: "returns.reasonWrongItem" },
  { value: "damaged", labelKey: "returns.reasonDamaged" },
  { value: "changed_mind", labelKey: "returns.reasonChangedMind" },
  { value: "other", labelKey: "returns.reasonOther" }
] as const satisfies ReadonlyArray<{ value: string; labelKey: StringKey }>;

// SCR-SF07-002 (the list) and SCR-SF07-001 (the request form), which this
// route hosts at `?order=<id>` — the entry point is the "request a return"
// action on a delivered order.
//
// Was a bare `<ul>` printing each return's raw order UUID beside its raw
// status enum, with no way to request one at all: the eligibility and
// creation endpoints have been built and callable since S13 and nothing in
// the UI ever reached them.
//
// The rule the form exists to enforce: **ineligible means no form.** Not a
// disabled submit, not a form that errors on send — an order past its
// seven-day window shows why and offers the way out, and nothing else.
export default function ReturnsPage() {
  const locale = useLocale();
  const params = useSearchParams();
  const orderId = params.get("order");

  const [loggedIn, setLoggedIn] = useState<boolean | undefined>(undefined);
  const [items, setItems] = useState<ReturnListResponse["items"] | null>(null);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [choices, setChoices] = useState<Record<string, LineChoice>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(Boolean(getToken()));
  }, []);

  const load = useCallback(() => {
    setError(null);
    authedFetch<ReturnListResponse>("/api/v1/returns")
      .then((res) => setItems(res.items))
      .catch((thrown) => {
        if (isSessionEnded(thrown)) return setLoggedIn(false);
        setError(messageFor(locale, thrown));
      });

    if (!orderId) return;
    authedFetch<Eligibility>(`/api/v1/orders/${orderId}/return-eligibility`)
      .then((res) => {
        setEligibility(res);
        setChoices(
          Object.fromEntries(
            res.lines.map((line) => [line.orderLineId, { selected: false, qty: 1, unopened: false }])
          )
        );
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale, orderId]);

  useEffect(() => {
    if (loggedIn) load();
  }, [loggedIn, load]);

  function updateChoice(lineId: string, patch: Partial<LineChoice>) {
    setChoices((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? { selected: false, qty: 1, unopened: false }), ...patch } }));
    setFormError(null);
  }

  // EP-SF-051. `unopened` is `z.literal(true)` in the contract — the server
  // will not accept a line without the attestation, so the client must not
  // pretend it can send one.
  const chosen = Object.entries(choices)
    .filter(([, choice]) => choice.selected && choice.unopened)
    .map(([orderLineId, choice]) => ({ orderLineId, qty: choice.qty, unopened: true as const }));

  const needsNote = reason === "other" && note.trim().length === 0;
  const canSubmit = chosen.length > 0 && reason !== "" && !needsNote;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!orderId) return;
    if (chosen.length === 0) {
      setFormError(t(locale, "returns.selectAtLeastOne"));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await authedFetch(`/api/v1/orders/${orderId}/returns`, {
        method: "POST",
        body: JSON.stringify({
          lines: chosen,
          reasonCode: reason,
          ...(note.trim() ? { note: note.trim() } : {})
        })
      });
      setSubmitted(true);
      setEligibility(null);
      load();
    } catch (thrown) {
      setFormError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  const loading = loggedIn && items === null && !error;

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="returns-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="returns-title" title={t(locale, "returns.title")} />

            {loggedIn === false ? <LoginForm promptKey="auth.leadOrders" onLoggedIn={() => setLoggedIn(true)} /> : null}

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

            {submitted ? (
              <Banner tone="success" title={t(locale, "returns.submitted")}>
                {t(locale, "returns.submittedHint")}
              </Banner>
            ) : null}

            {/* ---- SCR-SF07-001: the request form -------------------- */}
            {orderId && eligibility && !eligibility.eligible ? (
              // Ineligible means no form at all. Showing the fields greyed
              // out would invite someone to fill in an attestation about an
              // order that can no longer be returned.
              <Banner
                tone="warn"
                title={t(locale, "returns.ineligibleTitle")}
                action={
                  <ButtonLink linkAs={Link} href={`/orders/${orderId}`} variant="ghost" size="sm">
                    {t(locale, "orders.title")}
                  </ButtonLink>
                }
              >
                {t(locale, "returns.ineligibleHint")}
              </Banner>
            ) : null}

            {orderId && eligibility?.eligible ? (
              <Card>
                <form onSubmit={submit}>
                  <Stack gap="lg">
                    <h2 className="ps-section-head__title">{t(locale, "returns.requestTitle")}</h2>

                    <Banner tone="info" title={t(locale, "returns.eligibleTitle")}>
                      {eligibility.windowClosesAt
                        ? t(locale, "returns.windowCloses", { date: date(locale, eligibility.windowClosesAt) })
                        : null}
                    </Banner>

                    <Stack gap="md">
                      <h3 className="ps-eyebrow">{t(locale, "returns.chooseLines")}</h3>
                      <LineList label={t(locale, "returns.chooseLines")}>
                        {eligibility.lines.map((line) => {
                          const choice = choices[line.orderLineId] ?? { selected: false, qty: 1, unopened: false };
                          return (
                            <LineItem
                              key={line.orderLineId}
                              // EP-SF-050 identifies each line by its SKU
                              // slug and nothing else — no name, no picture.
                              // The slug is the product's own URL segment, so
                              // it is at least resolvable; it is rendered as
                              // a link to the datasheet rather than as a bare
                              // technical string sitting on the page.
                              title={
                                <Link href={`/catalog/${line.slug}`} className="ps-datalist__link">
                                  {line.slug}
                                </Link>
                              }
                              control={
                                <Checkbox
                                  label={t(locale, "returns.includeLine")}
                                  checked={choice.selected}
                                  onChange={(event) => updateChoice(line.orderLineId, { selected: event.target.checked })}
                                />
                              }
                              notes={
                                choice.selected ? (
                                  <Stack gap="sm">
                                    <QtyStepper
                                      label={t(locale, "returns.qtyToReturn")}
                                      value={choice.qty}
                                      min={1}
                                      max={line.qtyEligible}
                                      increaseLabel={t(locale, "cart.increase")}
                                      decreaseLabel={t(locale, "cart.decrease")}
                                      onChange={(qty) => updateChoice(line.orderLineId, { qty })}
                                    />
                                    {/* The attestation, per line and never
                                        pre-ticked: an opened container cannot
                                        be taken back, and the customer is the
                                        only one who can say. */}
                                    <Checkbox
                                      label={t(locale, "returns.unopened")}
                                      description={t(locale, "returns.unopenedHint")}
                                      checked={choice.unopened}
                                      onChange={(event) =>
                                        updateChoice(line.orderLineId, { unopened: event.target.checked })
                                      }
                                    />
                                  </Stack>
                                ) : null
                              }
                              meta={
                                <LineNote tone="muted">
                                  {t(locale, "orders.qty")}: <span className="ps-ltr">{count(line.qtyEligible)}</span>
                                </LineNote>
                              }
                            />
                          );
                        })}
                      </LineList>
                    </Stack>

                    <RadioGroup
                      label={t(locale, "returns.reasonCode")}
                      name="reason"
                      required
                      value={reason}
                      onChange={setReason}
                      options={REASONS.map((option) => ({ value: option.value, label: t(locale, option.labelKey) }))}
                    />

                    {reason === "other" ? (
                      <Textarea
                        label={t(locale, "returns.noteForOther")}
                        required
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    ) : null}

                    {formError ? <Banner tone="danger">{formError}</Banner> : null}

                    <Cluster gap="sm">
                      <Button type="submit" variant="gold" busy={busy} disabled={!canSubmit}>
                        {t(locale, "returns.submit")}
                      </Button>
                      <ButtonLink linkAs={Link} href={`/orders/${orderId}`} variant="ghost">
                        {t(locale, "common.cancel")}
                      </ButtonLink>
                    </Cluster>
                  </Stack>
                </form>
              </Card>
            ) : null}

            {/* ---- SCR-SF07-002: the list --------------------------- */}
            {loading ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="md">
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="md" />
                </Stack>
              </div>
            ) : null}

            {items !== null ? (
              <Stack gap="md">
                <h2 className="ps-section-head__title">{t(locale, "returns.listLabel")}</h2>
                <DataList
                  label={t(locale, "returns.listLabel")}
                  state={items.length === 0 ? "empty" : "ready"}
                  emptyTitle={t(locale, "returns.empty")}
                  emptyDescription={t(locale, "returns.emptyHint")}
                  emptyAction={
                    <ButtonLink linkAs={Link} href="/orders" variant="gold">
                      {t(locale, "orders.title")}
                    </ButtonLink>
                  }
                  items={items.map((entry) => ({
                    id: entry.returnId,
                    title: (
                      <IdDisplay
                        id={entry.returnId}
                        label={t(locale, "returns.returnNumber")}
                        copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                      />
                    ),
                    status: <StatusBadge kind="return" value={entry.status} locale={locale} />,
                    fields: [
                      {
                        label: t(locale, "orders.orderNumber"),
                        value: (
                          <IdDisplay
                            id={entry.orderId}
                            copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                          />
                        )
                      },
                      { label: t(locale, "orders.placedAt"), value: <DateTime iso={entry.createdAt} locale={locale} /> }
                    ],
                    actions: (
                      <Cluster gap="sm">
                        <ButtonLink linkAs={Link} href={`/orders/${entry.orderId}`} variant="ghost" size="sm">
                          {t(locale, "orders.title")}
                        </ButtonLink>
                        {/* An approved return is the point at which we need
                            somewhere to send the money. It appears only on
                            an approved one, because asking for a bank
                            account while a request is still under review is
                            asking for a detail we may never use. */}
                        {entry.status === "approved" ? <RefundIban returnId={entry.returnId} /> : null}
                      </Cluster>
                    )
                  }))}
                />
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
