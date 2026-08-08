"use client";

import type { AdminSupplierListResponse, DualControlListResponse, MeResponse } from "@petrospecial/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
  Cluster,
  Container,
  DataTable,
  DualControl,
  Money,
  Page,
  Section,
  SectionHead,
  Select,
  Stack,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

type Supplier = AdminSupplierListResponse["items"][number];
type RowState = "below-threshold" | "pending" | "approved" | "rejected";

// SCR-AC03-001 — AC-03.
//
// A credit-limit change above SAR 100,000 does not apply: EP-AC-021 answers
// `pending_dual_control` and acknowledging it requires a genuinely different
// super-admin. The old console reported that as the bare string "pending a
// second admin's ack" in a table cell, which reads as an error rather than as
// the control working exactly as designed.
//
// It is a DualControl panel now, and the threshold is stated before anyone
// types a number into the field rather than after.
function SuppliersCreditInner() {
  const locale = useLocale();
  const [items, setItems] = useState<Supplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [pending, setPending] = useState<DualControlListResponse["items"]>([]);
  const [ackBusyId, setAckBusyId] = useState<string | null>(null);

  const [tierDrafts, setTierDrafts] = useState<Record<string, "bronze" | "silver" | "gold">>({});
  const [tierReasonDrafts, setTierReasonDrafts] = useState<Record<string, string>>({});
  const [tierBusyId, setTierBusyId] = useState<string | null>(null);
  const [tierSavedId, setTierSavedId] = useState<string | null>(null);

  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [overrideSupplierId, setOverrideSupplierId] = useState("");
  const [overrideOrderId, setOverrideOrderId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideDone, setOverrideDone] = useState(false);

  const load = useCallback(() => {
    setError(null);
    authedFetch<AdminSupplierListResponse>("/api/v1/admin/suppliers")
      .then((res) => setItems(res.items))
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  const loadPending = useCallback(() => {
    // Best-effort: a stale/empty pending list never blocks the main
    // credit-limit table from working.
    authedFetch<DualControlListResponse>("/api/v1/admin/dual-control")
      .then((res) => setPending(res.items))
      .catch(() => setPending([]));
  }, []);

  useEffect(load, [load]);
  useEffect(loadPending, [loadPending]);
  useEffect(() => {
    // Best-effort, same reasoning as loadPending: the credit table works
    // with or without knowing the actor's exact role, this only gates the
    // override form the server would reject anyway.
    authedFetch<MeResponse>("/api/v1/me")
      .then((res) => setIsSuperAdmin(res.roles.includes("super_admin")))
      .catch(() => setIsSuperAdmin(false));
  }, []);

  async function applyTier(supplierId: string) {
    const tier = tierDrafts[supplierId];
    const reason = tierReasonDrafts[supplierId];
    if (!tier || !reason?.trim()) return;
    setTierBusyId(supplierId);
    setTierSavedId(null);
    setError(null);
    try {
      await authedFetch(`/api/v1/admin/suppliers/${supplierId}/tier`, {
        method: "PUT",
        body: JSON.stringify({ tier, reason })
      });
      setTierSavedId(supplierId);
      setTierReasonDrafts((prev) => ({ ...prev, [supplierId]: "" }));
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setTierBusyId(null);
    }
  }

  async function submitOverride(event: React.FormEvent) {
    event.preventDefault();
    setOverrideBusy(true);
    setOverrideError(null);
    setOverrideDone(false);
    try {
      await authedFetch(`/api/v1/admin/suppliers/${overrideSupplierId}/credit-override`, {
        method: "POST",
        body: JSON.stringify({ orderId: overrideOrderId, reason: overrideReason })
      });
      setOverrideDone(true);
      setOverrideOrderId("");
      setOverrideReason("");
    } catch (thrown) {
      setOverrideError(messageFor(locale, thrown));
    } finally {
      setOverrideBusy(false);
    }
  }

  // A pending approval only records status - the actual limit change is
  // applied by resubmitting the same PUT credit-limit request, which
  // credit.admin_set_credit_limit then finds an approved match for
  // (see the DB function's own idempotent-approval check). A different
  // super_admin approving is the one moment that resubmission is both
  // correct and safe to do automatically, so "acknowledge" here really
  // means "approve and apply" from the operator's point of view.
  async function acknowledgeAndApply(approval: DualControlListResponse["items"][number]) {
    setAckBusyId(approval.approvalId);
    setError(null);
    try {
      await authedFetch(`/api/v1/admin/dual-control/${approval.approvalId}/acknowledge`, { method: "POST" });
      await authedFetch(`/api/v1/admin/suppliers/${approval.supplierId}/credit-limit`, {
        method: "PUT",
        body: JSON.stringify({ newLimit: Number(approval.newLimit), reason: "dual-control approval applied" })
      });
      loadPending();
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setAckBusyId(null);
    }
  }

  async function saveLimit(supplierId: string) {
    const newLimit = Number(drafts[supplierId]);
    if (!newLimit || newLimit <= 0) return;
    setBusyId(supplierId);
    setError(null);
    try {
      const res = await authedFetch<{ status: string; newLimit?: string }>(
        `/api/v1/admin/suppliers/${supplierId}/credit-limit`,
        { method: "PUT", body: JSON.stringify({ newLimit, reason: "admin console adjustment" }) }
      );
      setRowState((prev) => ({
        ...prev,
        [supplierId]: res.status === "pending_dual_control" ? "pending" : "approved"
      }));
      load();
    } catch (thrown) {
      setRowState((prev) => ({ ...prev, [supplierId]: "rejected" }));
      setError(messageFor(locale, thrown));
    } finally {
      setBusyId(null);
    }
  }

  const state = error ? "error" : items === null ? "loading" : items.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="credit-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="credit-title" title={t(locale, "nav.suppliersCredit")} />

            {/* The rule is learned before it bites, not after a change
                silently fails to apply. */}
            <DualControl
              state="below-threshold"
              thresholdNote={t(locale, "admin.dualThreshold")}
              pendingLabel={t(locale, "admin.dualPending")}
              approvedLabel={t(locale, "admin.dualApproved")}
              rejectedLabel={t(locale, "admin.dualRejected")}
            />

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

            {pending.length > 0 ? (
              <DataTable
                caption={t(locale, "admin.pendingApprovals")}
                state="ready"
                rows={pending}
                getRowKey={(row) => row.approvalId}
                columns={[
                  {
                    key: "business",
                    header: t(locale, "admin.businessName"),
                    emphasis: "primary",
                    render: (row) => items?.find((s) => s.supplierId === row.supplierId)?.businessNameEn ?? row.supplierId
                  },
                  {
                    key: "newLimit",
                    header: t(locale, "admin.newLimit"),
                    align: "end",
                    render: (row) => <Money amount={row.newLimit} locale={locale} emphasis="strong" />
                  },
                  {
                    key: "action",
                    header: "",
                    render: (row) => (
                      <Button
                        variant="gold"
                        size="sm"
                        busy={ackBusyId === row.approvalId}
                        onClick={() => acknowledgeAndApply(row)}
                      >
                        {t(locale, "admin.acknowledgeAndApply")}
                      </Button>
                    )
                  }
                ]}
              />
            ) : null}

            <DataTable
              caption={t(locale, "nav.suppliersCredit")}
              state={state}
              stickyHeader
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "admin.creditEmpty")}
              rows={items ?? []}
              getRowKey={(row) => row.supplierId}
              columns={[
                {
                  key: "business",
                  header: t(locale, "admin.businessName"),
                  emphasis: "primary",
                  render: (row) => row.businessNameEn
                },
                {
                  key: "tier",
                  header: t(locale, "supplier.tier"),
                  render: (row) => (
                    <Stack gap="sm">
                      <Badge variant="gold">{row.tier}</Badge>
                      <Cluster gap="sm">
                        <Select
                          label={t(locale, "admin.newTier")}
                          value={tierDrafts[row.supplierId] ?? row.tier}
                          onChange={(event) =>
                            setTierDrafts((prev) => ({ ...prev, [row.supplierId]: event.target.value as "bronze" | "silver" | "gold" }))
                          }
                          options={[
                            { value: "bronze", label: "bronze" },
                            { value: "silver", label: "silver" },
                            { value: "gold", label: "gold" }
                          ]}
                        />
                        <TextField
                          label={t(locale, "admin.tierReasonHint")}
                          hideLabel
                          placeholder={t(locale, "admin.tierReasonHint")}
                          value={tierReasonDrafts[row.supplierId] ?? ""}
                          onChange={(event) =>
                            setTierReasonDrafts((prev) => ({ ...prev, [row.supplierId]: event.target.value }))
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          busy={tierBusyId === row.supplierId}
                          disabled={
                            !tierDrafts[row.supplierId] ||
                            tierDrafts[row.supplierId] === row.tier ||
                            !tierReasonDrafts[row.supplierId]?.trim()
                          }
                          onClick={() => applyTier(row.supplierId)}
                        >
                          {t(locale, "admin.applyTier")}
                        </Button>
                      </Cluster>
                      {tierSavedId === row.supplierId ? <Badge variant="success">{t(locale, "admin.tierApplied")}</Badge> : null}
                    </Stack>
                  )
                },
                {
                  key: "creditLimit",
                  header: t(locale, "supplier.creditLimit"),
                  align: "end",
                  render: (row) => <Money amount={row.creditLimit} locale={locale} />
                },
                {
                  key: "exposure",
                  header: t(locale, "supplier.exposure"),
                  align: "end",
                  render: (row) => <Money amount={row.exposure} locale={locale} />
                },
                {
                  key: "headroom",
                  header: t(locale, "supplier.headroom"),
                  align: "end",
                  render: (row) => <Money amount={row.headroom} locale={locale} emphasis="strong" />
                },
                {
                  key: "newLimit",
                  header: t(locale, "admin.newLimit"),
                  render: (row) => (
                    <Stack gap="sm">
                      <Cluster gap="sm">
                        <TextField
                          label={t(locale, "admin.newLimit")}
                          forceLtr
                          inputMode="decimal"
                          value={drafts[row.supplierId] ?? ""}
                          onChange={(event) =>
                            setDrafts((prev) => ({ ...prev, [row.supplierId]: event.target.value }))
                          }
                        />
                        <Button
                          variant="gold"
                          size="sm"
                          busy={busyId === row.supplierId}
                          disabled={!drafts[row.supplierId]}
                          onClick={() => saveLimit(row.supplierId)}
                        >
                          {t(locale, "admin.applyLimit")}
                        </Button>
                      </Cluster>
                      {rowState[row.supplierId] ? (
                        <DualControl
                          state={rowState[row.supplierId] as RowState}
                          thresholdNote={t(locale, "admin.dualThreshold")}
                          pendingLabel={t(locale, "admin.dualPending")}
                          approvedLabel={t(locale, "admin.dualApproved")}
                          rejectedLabel={t(locale, "admin.dualRejected")}
                        />
                      ) : null}
                    </Stack>
                  )
                }
              ]}
            />

            {/* EP-AC-024 — break-glass over a credit-blocked order. Same
                manual-id-entry shape as /privacy's PII lookup: there is no
                endpoint listing blocked orders to pick from (none has ever
                needed one — session 1's own §8 notes no zero-rows evidence
                this has actually blocked a real operation), so an operator
                who already knows the order id from a supplier call records
                the exception here. */}
            <Stack gap="md">
              <h2 className="ps-section-head__title">{t(locale, "admin.creditOverrideSection")}</h2>
              <Banner tone="warn">{t(locale, "admin.creditOverrideHint")}</Banner>

              {!isSuperAdmin ? <Banner tone="warn">{t(locale, "admin.creditOverrideSuperAdminOnly")}</Banner> : null}

              <Card>
                <form onSubmit={submitOverride}>
                  <Stack gap="md">
                    <Select
                      label={t(locale, "admin.overrideSupplier")}
                      required
                      value={overrideSupplierId}
                      placeholder={t(locale, "form.selectPlaceholder")}
                      disabled={!isSuperAdmin}
                      onChange={(event) => setOverrideSupplierId(event.target.value)}
                      options={(items ?? []).map((s) => ({ value: s.supplierId, label: s.businessNameEn }))}
                    />
                    <TextField
                      label={t(locale, "admin.overrideOrderId")}
                      hint={t(locale, "admin.overrideOrderIdHint")}
                      required
                      forceLtr
                      disabled={!isSuperAdmin}
                      value={overrideOrderId}
                      onChange={(event) => setOverrideOrderId(event.target.value)}
                    />
                    <TextField
                      label={t(locale, "admin.overrideReason")}
                      required
                      disabled={!isSuperAdmin}
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                    />
                    {overrideError ? <Banner tone="danger">{overrideError}</Banner> : null}
                    {overrideDone ? <Banner tone="success">{t(locale, "admin.overrideApplied")}</Banner> : null}
                    <Button
                      type="submit"
                      variant="gold"
                      busy={overrideBusy}
                      disabled={!isSuperAdmin || !overrideSupplierId || !overrideOrderId || !overrideReason.trim()}
                    >
                      {t(locale, "admin.applyOverride")}
                    </Button>
                  </Stack>
                </form>
              </Card>
            </Stack>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function SuppliersCreditPage() {
  return (
    <LoginGate>
      <SuppliersCreditInner />
    </LoginGate>
  );
}
