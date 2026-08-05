"use client";

import type { AdminSupplierListResponse } from "@petrospecial/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Cluster,
  Container,
  DataTable,
  DualControl,
  Money,
  Page,
  Section,
  SectionHead,
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

  const load = useCallback(() => {
    setError(null);
    authedFetch<AdminSupplierListResponse>("/api/v1/admin/suppliers")
      .then((res) => setItems(res.items))
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

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
                  render: (row) => <Badge variant="gold">{row.tier}</Badge>
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
