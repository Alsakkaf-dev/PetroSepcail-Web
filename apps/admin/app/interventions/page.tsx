"use client";

import type { InterventionListResponse } from "@petrospecial/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Card,
  Container,
  DataTable,
  DateTime,
  IdDisplay,
  Page,
  ReasonGate,
  Section,
  SectionHead,
  Select,
  Stack,
  TextField,
  type ReasonOption
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t, type Locale, type StringKey } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

type Intervention = InterventionListResponse["items"][number];

// `audit.reason_codes` (0064) is a fixed list and the API rejects anything
// outside it with INVALID_REASON_CODE, so the console offers exactly this set
// and never a free-text reason. `other_with_note` is the one that needs the
// note, and until the note is written the commit control stays disabled.
const REASON_KEYS: Array<{ value: string; labelKey: StringKey; requiresNote?: boolean }> = [
  { value: "customer_request", labelKey: "admin.reasonCustomerRequest" },
  { value: "fraud_suspected", labelKey: "admin.reasonFraudSuspected" },
  { value: "address_unreachable", labelKey: "admin.reasonAddressUnreachable" },
  { value: "stock_unavailable", labelKey: "admin.reasonStockUnavailable" },
  { value: "duplicate_order", labelKey: "admin.reasonDuplicateOrder" },
  { value: "payment_issue", labelKey: "admin.reasonPaymentIssue" },
  { value: "quality_complaint", labelKey: "admin.reasonQualityComplaint" },
  { value: "policy_violation", labelKey: "admin.reasonPolicyViolation" },
  { value: "other_with_note", labelKey: "admin.reasonOtherWithNote", requiresNote: true }
];

function reasonOptions(locale: Locale): ReasonOption[] {
  return REASON_KEYS.map((reason) => ({
    value: reason.value,
    label: t(locale, reason.labelKey),
    ...(reason.requiresNote ? { requiresNote: true } : {})
  }));
}

const KIND_LABEL: Record<string, StringKey> = {
  force_cancel: "admin.kindForceCancel",
  address_edit: "admin.kindAddressEdit",
  refund_override: "admin.kindRefundOverride",
  failed_delivery: "admin.kindFailedDelivery",
  return_decision: "admin.kindReturnDecision",
  review_moderation: "admin.kindReviewModeration"
};

const OUTCOME_LABEL: Record<string, StringKey> = {
  open: "admin.outcomeOpen",
  resolved: "admin.outcomeResolved",
  rejected: "admin.outcomeRejected"
};

// SCR-AC05-001 — AC-05.
//
// Was thirteen inline styles, three ungrouped forms each with a bare `<select>`
// of raw enum codes ("other_with_note" shown to an operator as-is), a literal
// green status line, headings carrying endpoint ids ("Force-cancel order
// (EP-AC-041)"), and a raw <table> printing the raw reason code back.
//
// Each action is a ReasonGate now: the fixed list, the conditional note, and a
// commit control that stays disabled until the reason is valid — the same rule
// the server enforces, enforced here first so nobody meets it as a 422.
function InterventionsInner() {
  const locale = useLocale();
  const options = reasonOptions(locale);

  const [items, setItems] = useState<Intervention[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [cancelOrderId, setCancelOrderId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelNote, setCancelNote] = useState("");

  const [returnId, setReturnId] = useState("");
  const [returnDecision, setReturnDecision] = useState("approve");
  const [returnReason, setReturnReason] = useState("");
  const [returnNote, setReturnNote] = useState("");

  const [reviewId, setReviewId] = useState("");
  const [reviewAction, setReviewAction] = useState("hide");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  const load = useCallback(() => {
    setError(null);
    authedFetch<InterventionListResponse>("/api/v1/admin/interventions")
      .then((res) => setItems(res.items))
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  async function run(key: string, path: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      await authedFetch(path, { method: "POST", body: JSON.stringify(body) });
      setDone(t(locale, "admin.outcomeResolved"));
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  const state = error ? "error" : items === null ? "loading" : items.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="interventions-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="interventions-title"
              title={t(locale, "nav.interventions")}
              lead={t(locale, "admin.allActionsLogged")}
            />

            {error ? <Banner tone="danger">{error}</Banner> : null}
            {done ? <Banner tone="success">{done}</Banner> : null}

            <Card>
              <Stack gap="md">
                <h2 className="ps-section-head__title">{t(locale, "admin.forceCancel")}</h2>
                <TextField
                  label={t(locale, "admin.orderId")}
                  required
                  forceLtr
                  value={cancelOrderId}
                  onChange={(event) => setCancelOrderId(event.target.value)}
                />
                <ReasonGate
                  label={t(locale, "admin.reasonCode")}
                  name="cancel-reason"
                  options={options}
                  value={cancelReason}
                  onChange={setCancelReason}
                  note={cancelNote}
                  onNoteChange={setCancelNote}
                  noteLabel={t(locale, "admin.reasonNote")}
                  noteHint={t(locale, "admin.reasonNoteHint")}
                  hint={t(locale, "admin.reasonRequired")}
                >
                  {(ready) => (
                    <Button
                      variant="danger"
                      busy={busy === "cancel"}
                      disabled={!ready || !cancelOrderId}
                      onClick={() =>
                        run("cancel", `/api/v1/admin/orders/${cancelOrderId}/cancel`, {
                          reasonCode: cancelReason,
                          ...(cancelNote.trim() ? { note: cancelNote.trim() } : {})
                        })
                      }
                    >
                      {t(locale, "admin.forceCancel")}
                    </Button>
                  )}
                </ReasonGate>
              </Stack>
            </Card>

            <Card>
              <Stack gap="md">
                <h2 className="ps-section-head__title">{t(locale, "admin.decideReturn")}</h2>
                <TextField
                  label={t(locale, "admin.returnId")}
                  required
                  forceLtr
                  value={returnId}
                  onChange={(event) => setReturnId(event.target.value)}
                />
                <Select
                  label={t(locale, "admin.decision")}
                  value={returnDecision}
                  onChange={(event) => setReturnDecision(event.target.value)}
                  options={[
                    { value: "approve", label: t(locale, "admin.approve") },
                    { value: "reject", label: t(locale, "admin.reject") }
                  ]}
                />
                <ReasonGate
                  label={t(locale, "admin.reasonCode")}
                  name="return-reason"
                  options={options}
                  value={returnReason}
                  onChange={setReturnReason}
                  note={returnNote}
                  onNoteChange={setReturnNote}
                  noteLabel={t(locale, "admin.reasonNote")}
                  noteHint={t(locale, "admin.reasonNoteHint")}
                  hint={t(locale, "admin.reasonRequired")}
                >
                  {(ready) => (
                    <Button
                      variant="gold"
                      busy={busy === "return"}
                      disabled={!ready || !returnId}
                      onClick={() =>
                        run("return", `/api/v1/admin/returns/${returnId}/decision`, {
                          decision: returnDecision,
                          reasonCode: returnReason
                        })
                      }
                    >
                      {t(locale, "admin.decideReturn")}
                    </Button>
                  )}
                </ReasonGate>
              </Stack>
            </Card>

            <Card>
              <Stack gap="md">
                <h2 className="ps-section-head__title">{t(locale, "admin.moderateReview")}</h2>
                <TextField
                  label={t(locale, "admin.reviewId")}
                  required
                  forceLtr
                  value={reviewId}
                  onChange={(event) => setReviewId(event.target.value)}
                />
                <Select
                  label={t(locale, "admin.action")}
                  value={reviewAction}
                  onChange={(event) => setReviewAction(event.target.value)}
                  options={[
                    { value: "hide", label: t(locale, "admin.hide") },
                    { value: "remove", label: t(locale, "admin.removeReview") }
                  ]}
                />
                <ReasonGate
                  label={t(locale, "admin.reasonCode")}
                  name="review-reason"
                  options={options}
                  value={reviewReason}
                  onChange={setReviewReason}
                  note={reviewNote}
                  onNoteChange={setReviewNote}
                  noteLabel={t(locale, "admin.reasonNote")}
                  noteHint={t(locale, "admin.reasonNoteHint")}
                  hint={t(locale, "admin.reasonRequired")}
                >
                  {(ready) => (
                    <Button
                      variant="gold"
                      busy={busy === "review"}
                      disabled={!ready || !reviewId}
                      onClick={() =>
                        run("review", `/api/v1/admin/reviews/${reviewId}/moderate`, {
                          action: reviewAction,
                          reasonCode: reviewReason
                        })
                      }
                    >
                      {t(locale, "admin.moderateReview")}
                    </Button>
                  )}
                </ReasonGate>
              </Stack>
            </Card>

            <Stack gap="md">
              <h2 className="ps-section-head__title">{t(locale, "admin.recentInterventions")}</h2>
              <DataTable
                caption={t(locale, "admin.recentInterventions")}
                state={state}
                stickyHeader
                errorMessage={error ?? undefined}
                onRetry={load}
                retryLabel={t(locale, "common.retry")}
                emptyTitle={t(locale, "admin.interventionsEmpty")}
                rows={items ?? []}
                getRowKey={(row) => row.id}
                columns={[
                  {
                    key: "kind",
                    header: t(locale, "admin.kind"),
                    emphasis: "primary",
                    render: (row) => t(locale, KIND_LABEL[row.kind] ?? "admin.action")
                  },
                  {
                    key: "at",
                    header: t(locale, "admin.auditAt"),
                    render: (row) => <DateTime iso={row.createdAt} locale={locale} />
                  },
                  {
                    key: "order",
                    header: t(locale, "admin.orderId"),
                    render: (row) =>
                      row.orderId ? (
                        <IdDisplay
                          id={row.orderId}
                          copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                        />
                      ) : (
                        "—"
                      )
                  },
                  {
                    key: "reason",
                    header: t(locale, "admin.reasonCode"),
                    // The raw code reached the screen before this. Every
                    // reason now reads as the sentence it stands for.
                    render: (row) => {
                      const known = REASON_KEYS.find((reason) => reason.value === row.reasonCode);
                      return known ? t(locale, known.labelKey) : row.reasonCode;
                    }
                  },
                  {
                    key: "outcome",
                    header: t(locale, "admin.outcome"),
                    render: (row) => t(locale, OUTCOME_LABEL[row.outcome] ?? "admin.outcomeOpen")
                  }
                ]}
              />
            </Stack>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function InterventionsPage() {
  return (
    <LoginGate>
      <InterventionsInner />
    </LoginGate>
  );
}
