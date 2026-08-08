"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { BreachListResponse, PdplRequestListResponse } from "@petrospecial/contracts";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Container,
  DataTable,
  DateTime,
  IdDisplay,
  Page,
  Section,
  SectionHead,
  Select,
  Stack,
  StatusBadge,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../../lib/authClient";
import { LoginGate } from "../../../lib/LoginGate";

type PdplRequest = PdplRequestListResponse["items"][number];
type Breach = BreachListResponse["items"][number];

const PDPL_REQUEST_TERMINAL = new Set(["completed", "rejected"]);
const BREACH_TERMINAL = new Set(["closed"]);

// SCR-AC10-002 (built this session). EP-AC-091/092/093 have been callable
// since S18 with no screen anywhere ever calling them, and no GET route
// existed to even discover a request or breach's id — this is the first
// real UI path to either. Linked from /privacy rather than folded into it:
// the PII single-record lookup above is a fundamentally different action
// (a read, logged) from this screen (case management, also logged).
function PdplInner() {
  const locale = useLocale();

  const [requests, setRequests] = useState<PdplRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [kind, setKind] = useState<"access" | "correction" | "deletion">("access");
  const [createRequestBusy, setCreateRequestBusy] = useState(false);
  const [createRequestError, setCreateRequestError] = useState<string | null>(null);
  const [advanceRequestBusyId, setAdvanceRequestBusyId] = useState<string | null>(null);

  const [breaches, setBreaches] = useState<Breach[] | null>(null);
  const [breachesError, setBreachesError] = useState<string | null>(null);
  const [detectedAt, setDetectedAt] = useState("");
  const [scope, setScope] = useState("");
  const [createBreachBusy, setCreateBreachBusy] = useState(false);
  const [createBreachError, setCreateBreachError] = useState<string | null>(null);
  const [advanceBreachBusyId, setAdvanceBreachBusyId] = useState<string | null>(null);

  const loadRequests = useCallback(() => {
    setRequestsError(null);
    authedFetch<PdplRequestListResponse>("/api/v1/admin/pdpl/requests")
      .then((res) => setRequests(res.items))
      .catch((thrown) => setRequestsError(messageFor(locale, thrown)));
  }, [locale]);

  const loadBreaches = useCallback(() => {
    setBreachesError(null);
    authedFetch<BreachListResponse>("/api/v1/admin/pdpl/breaches")
      .then((res) => setBreaches(res.items))
      .catch((thrown) => setBreachesError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(loadRequests, [loadRequests]);
  useEffect(loadBreaches, [loadBreaches]);

  async function createRequest(event: React.FormEvent) {
    event.preventDefault();
    setCreateRequestBusy(true);
    setCreateRequestError(null);
    try {
      await authedFetch("/api/v1/admin/pdpl/requests", {
        method: "POST",
        body: JSON.stringify({ subjectId, kind })
      });
      setSubjectId("");
      loadRequests();
    } catch (thrown) {
      setCreateRequestError(messageFor(locale, thrown));
    } finally {
      setCreateRequestBusy(false);
    }
  }

  async function advanceRequest(id: string) {
    setAdvanceRequestBusyId(id);
    setRequestsError(null);
    try {
      await authedFetch(`/api/v1/admin/pdpl/requests/${id}/advance`, { method: "POST" });
      loadRequests();
    } catch (thrown) {
      setRequestsError(messageFor(locale, thrown));
    } finally {
      setAdvanceRequestBusyId(null);
    }
  }

  async function createBreach(event: React.FormEvent) {
    event.preventDefault();
    setCreateBreachBusy(true);
    setCreateBreachError(null);
    try {
      await authedFetch("/api/v1/admin/pdpl/breaches", {
        method: "POST",
        body: JSON.stringify({ detectedAt: new Date(detectedAt).toISOString(), scope })
      });
      setScope("");
      setDetectedAt("");
      loadBreaches();
    } catch (thrown) {
      setCreateBreachError(messageFor(locale, thrown));
    } finally {
      setCreateBreachBusy(false);
    }
  }

  async function advanceBreach(id: string) {
    setAdvanceBreachBusyId(id);
    setBreachesError(null);
    try {
      await authedFetch(`/api/v1/admin/pdpl/breaches/${id}/advance`, { method: "POST" });
      loadBreaches();
    } catch (thrown) {
      setBreachesError(messageFor(locale, thrown));
    } finally {
      setAdvanceBreachBusyId(null);
    }
  }

  const requestsState = requestsError ? "error" : requests === null ? "loading" : requests.length === 0 ? "empty" : "ready";
  const breachesState = breachesError ? "error" : breaches === null ? "loading" : breaches.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="pdpl-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="pdpl-title" title={t(locale, "admin.pdplTitle")} />
            <ButtonLink linkAs={Link} href="/privacy" variant="ghost">
              {t(locale, "common.back")}
            </ButtonLink>

            {/* ---- PDPL requests ---------------------------------------- */}
            <Stack gap="md">
              <h2 className="ps-section-head__title">{t(locale, "admin.pdplRequestsSection")}</h2>
              <Banner tone="info">{t(locale, "admin.pdplRequestsHint")}</Banner>

              <Card>
                <form onSubmit={createRequest}>
                  <Stack gap="md">
                    <TextField
                      label={t(locale, "admin.pdplSubjectId")}
                      hint={t(locale, "admin.pdplSubjectIdHint")}
                      required
                      forceLtr
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                    />
                    <Select
                      label={t(locale, "admin.pdplKind")}
                      value={kind}
                      onChange={(e) => setKind(e.target.value as typeof kind)}
                      options={[
                        { value: "access", label: t(locale, "admin.pdplKindAccess") },
                        { value: "correction", label: t(locale, "admin.pdplKindCorrection") },
                        { value: "deletion", label: t(locale, "admin.pdplKindDeletion") }
                      ]}
                    />
                    {createRequestError ? <Banner tone="danger">{createRequestError}</Banner> : null}
                    <Button type="submit" variant="gold" busy={createRequestBusy} disabled={!subjectId}>
                      {t(locale, "admin.pdplCreateRequest")}
                    </Button>
                  </Stack>
                </form>
              </Card>

              <DataTable
                caption={t(locale, "admin.pdplRequestsSection")}
                state={requestsState}
                errorMessage={requestsError ?? undefined}
                onRetry={loadRequests}
                retryLabel={t(locale, "common.retry")}
                emptyTitle={t(locale, "admin.pdplRequestsEmpty")}
                emptyDescription={t(locale, "admin.pdplRequestsEmptyHint")}
                rows={requests ?? []}
                getRowKey={(row) => row.id}
                columns={[
                  {
                    key: "id",
                    header: t(locale, "admin.pdplId"),
                    emphasis: "primary",
                    render: (row) => (
                      <IdDisplay id={row.id} copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }} />
                    )
                  },
                  {
                    key: "subject",
                    header: t(locale, "admin.pdplSubjectId"),
                    render: (row) => (
                      <IdDisplay id={row.subjectId} copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }} />
                    )
                  },
                  {
                    key: "kind",
                    header: t(locale, "admin.pdplKind"),
                    render: (row) =>
                      t(locale, row.kind === "access" ? "admin.pdplKindAccess" : row.kind === "correction" ? "admin.pdplKindCorrection" : "admin.pdplKindDeletion")
                  },
                  {
                    key: "status",
                    header: t(locale, "admin.outcome"),
                    render: (row) => <StatusBadge kind="pdplRequest" value={row.status} locale={locale} />
                  },
                  {
                    key: "graceUntil",
                    header: t(locale, "admin.pdplGraceUntil"),
                    render: (row) => (row.graceUntil ? <DateTime iso={row.graceUntil} locale={locale} /> : "—")
                  },
                  {
                    key: "createdAt",
                    header: t(locale, "admin.pdplCreatedAt"),
                    render: (row) => <DateTime iso={row.createdAt} locale={locale} />
                  },
                  {
                    key: "advance",
                    header: t(locale, "admin.pdplAdvance"),
                    align: "end",
                    render: (row) =>
                      PDPL_REQUEST_TERMINAL.has(row.status) ? (
                        "—"
                      ) : (
                        <Button
                          variant="dark"
                          size="sm"
                          busy={advanceRequestBusyId === row.id}
                          onClick={() => advanceRequest(row.id)}
                        >
                          {t(locale, "admin.pdplAdvance")}
                        </Button>
                      )
                  }
                ]}
              />
            </Stack>

            {/* ---- Breach notifications ---------------------------------- */}
            <Stack gap="md">
              <h2 className="ps-section-head__title">{t(locale, "admin.breachesSection")}</h2>
              <Banner tone="warn">{t(locale, "admin.breachesHint")}</Banner>

              <Card>
                <form onSubmit={createBreach}>
                  <Stack gap="md">
                    <TextField
                      label={t(locale, "admin.breachDetectedAt")}
                      type="datetime-local"
                      required
                      forceLtr
                      value={detectedAt}
                      onChange={(e) => setDetectedAt(e.target.value)}
                    />
                    <TextField
                      label={t(locale, "admin.breachScope")}
                      hint={t(locale, "admin.breachScopeHint")}
                      required
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                    />
                    {createBreachError ? <Banner tone="danger">{createBreachError}</Banner> : null}
                    <Button type="submit" variant="gold" busy={createBreachBusy} disabled={!detectedAt || !scope.trim()}>
                      {t(locale, "admin.breachCreate")}
                    </Button>
                  </Stack>
                </form>
              </Card>

              <DataTable
                caption={t(locale, "admin.breachesSection")}
                state={breachesState}
                errorMessage={breachesError ?? undefined}
                onRetry={loadBreaches}
                retryLabel={t(locale, "common.retry")}
                emptyTitle={t(locale, "admin.breachesEmpty")}
                emptyDescription={t(locale, "admin.breachesEmptyHint")}
                rows={breaches ?? []}
                getRowKey={(row) => row.id}
                columns={[
                  {
                    key: "id",
                    header: t(locale, "admin.pdplId"),
                    emphasis: "primary",
                    render: (row) => (
                      <IdDisplay id={row.id} copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }} />
                    )
                  },
                  { key: "scope", header: t(locale, "admin.breachScope"), render: (row) => row.scope },
                  {
                    key: "status",
                    header: t(locale, "admin.outcome"),
                    render: (row) => <StatusBadge kind="breach" value={row.status} locale={locale} />
                  },
                  {
                    key: "detectedAt",
                    header: t(locale, "admin.breachDetectedAt"),
                    render: (row) => <DateTime iso={row.detectedAt} locale={locale} />
                  },
                  {
                    key: "notifyBy",
                    header: t(locale, "admin.breachNotifyBy"),
                    render: (row) => <DateTime iso={row.notifyBy} locale={locale} />
                  },
                  {
                    key: "advance",
                    header: t(locale, "admin.pdplAdvance"),
                    align: "end",
                    render: (row) =>
                      BREACH_TERMINAL.has(row.status) ? (
                        "—"
                      ) : (
                        <Button
                          variant="dark"
                          size="sm"
                          busy={advanceBreachBusyId === row.id}
                          onClick={() => advanceBreach(row.id)}
                        >
                          {t(locale, "admin.pdplAdvance")}
                        </Button>
                      )
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

export default function PdplPage() {
  return (
    <LoginGate>
      <PdplInner />
    </LoginGate>
  );
}
