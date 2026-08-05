"use client";

import type { AuditLogResponse, VerifyChainResponse } from "@petrospecial/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Cluster,
  Container,
  DataTable,
  DateTime,
  Icon,
  IdDisplay,
  Ltr,
  Page,
  Section,
  SectionHead,
  Stack
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

type AuditRow = AuditLogResponse["items"][number];

// SCR-AC07-001 — AC-07. Read-only, and read-only by construction: there is no
// edit control and no delete control anywhere on this screen, because there is
// no endpoint behind either and an audit log that can be edited is not one.
//
// An `admin` sees only their own entries and a `super_admin` sees all; the API
// enforces that, not this screen.
//
// Was four inline styles, a raw <table>, a heading reading "Audit Log (AC-07)"
// with the internal spec ID in it, and the chain-verification result as the
// bare string "BROKEN at rows: …".
function AuditInner() {
  const locale = useLocale();
  const [items, setItems] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<VerifyChainResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    authedFetch<AuditLogResponse>("/api/v1/admin/audit")
      .then((res) => setItems(res.items))
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  async function verifyChain() {
    setBusy(true);
    setError(null);
    try {
      setChain(await authedFetch<VerifyChainResponse>("/api/v1/admin/audit/verify-chain"));
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  const state = error ? "error" : items === null ? "loading" : items.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="audit-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="audit-title"
              title={t(locale, "nav.auditLog")}
              lead={t(locale, "admin.auditReadOnly")}
            />

            {error ? <Banner tone="danger">{error}</Banner> : null}

            <Cluster gap="md">
              <Button variant="ghost" busy={busy} onClick={verifyChain}>
                {t(locale, "admin.verifyChain")}
              </Button>
              {chain ? (
                <span role="status">
                  {chain.intact ? (
                    <Badge variant="success">
                      <Icon name="check-circle" size="sm" />
                      {t(locale, "admin.chainIntact")}
                    </Badge>
                  ) : (
                    <Badge variant="danger">
                      <Icon name="alert" size="sm" />
                      {t(locale, "admin.chainBroken")}
                    </Badge>
                  )}
                </span>
              ) : null}
            </Cluster>

            {chain && !chain.intact && chain.brokenAt?.length ? (
              <Banner tone="danger" title={t(locale, "admin.chainBroken")}>
                <Ltr>{t(locale, "admin.chainBrokenAt", { rows: chain.brokenAt.join(", ") })}</Ltr>
              </Banner>
            ) : null}

            <DataTable
              caption={t(locale, "nav.auditLog")}
              state={state}
              stickyHeader
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "admin.auditEmpty")}
              emptyDescription={t(locale, "admin.auditEmptyHint")}
              rows={items ?? []}
              getRowKey={(row) => `${row.at}-${row.action}-${row.resourceId}`}
              columns={[
                {
                  key: "at",
                  header: t(locale, "admin.auditAt"),
                  emphasis: "primary",
                  render: (row) => <DateTime iso={row.at} locale={locale} />
                },
                { key: "role", header: t(locale, "admin.auditRole"), render: (row) => row.role },
                { key: "action", header: t(locale, "admin.auditAction"), render: (row) => <Ltr>{row.action}</Ltr> },
                { key: "resource", header: t(locale, "admin.auditResource"), render: (row) => <Ltr>{row.resource}</Ltr> },
                {
                  key: "resourceId",
                  header: t(locale, "admin.auditResourceId"),
                  render: (row) =>
                    row.resourceId ? (
                      <IdDisplay
                        id={row.resourceId}
                        copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                      />
                    ) : (
                      "—"
                    )
                },
                { key: "reason", header: t(locale, "admin.auditReason"), render: (row) => row.reason ?? "—" }
              ]}
            />
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function AuditPage() {
  return (
    <LoginGate>
      <AuditInner />
    </LoginGate>
  );
}
