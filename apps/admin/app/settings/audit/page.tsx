"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  Container,
  DataTable,
  DateTime,
  IdDisplay,
  Ltr,
  Page,
  Section,
  SectionHead,
  Stack,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../../lib/authClient";
import { LoginGate } from "../../../lib/LoginGate";

interface AuditEntry {
  at: string;
  actorId: string | null;
  role: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  reason: string | null;
}

interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

/** The two resources this viewer covers. Anything else in `audit.audit_log`
 * touches orders, credit or customer records, and the whole point of this
 * screen is that it is the one audit surface with no personal data on it at
 * all — so it filters at the request, not in the render. */
const CONFIG_RESOURCES = ["core.settings", "core.feature_flags"] as const;

// SCR-PC12-002 — the read-only configuration audit viewer.
//
// Deliberately not a second copy of /audit (SCR-AC07-001, which is the full
// explorer with chain verification). This one answers one question — who
// changed a platform setting, and when — and it answers it without ever
// putting a customer's data on the screen. There is no edit control, no
// delete control, and no row action of any kind anywhere on it.
function ConfigAuditInner() {
  const locale = useLocale();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [actorId, setActorId] = useState("");
  const [appliedActor, setAppliedActor] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setEntries(null);
    Promise.all(
      CONFIG_RESOURCES.map((resource) => {
        const query = new URLSearchParams({ resource });
        if (appliedActor) query.set("actorId", appliedActor);
        return authedFetch<AuditPage>(`/api/v1/admin/audit?${query.toString()}`);
      })
    )
      .then((pages) => setEntries(pages.flatMap((page) => page.items)))
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [appliedActor, locale]);

  useEffect(load, [load]);

  // Two requests, one list: the endpoint filters by a single resource, so the
  // merge and the ordering happen here rather than being left to whichever
  // request answered first.
  const rows = useMemo(
    () => [...(entries ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
    [entries]
  );

  const state = error ? "error" : entries === null ? "loading" : rows.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="config-audit-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="config-audit-title" title={t(locale, "audit.title")} />

            <Banner tone="info" icon="lock">
              {t(locale, "audit.readOnly")}
            </Banner>
            <Banner tone="info" icon="shield">
              {t(locale, "audit.noPii")}
            </Banner>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedActor(actorId.trim());
              }}
            >
              <Stack gap="sm">
                <TextField
                  label={t(locale, "audit.actor")}
                  name="actorId"
                  forceLtr
                  hint={t(locale, "admin.customerIdHint")}
                  value={actorId}
                  onChange={(e) => setActorId(e.target.value)}
                />
                <Button type="submit" variant="dark" size="sm">
                  {t(locale, "audit.apply")}
                </Button>
              </Stack>
            </form>

            <DataTable
              caption={t(locale, "audit.title")}
              state={state}
              stickyHeader
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "audit.empty")}
              emptyDescription={t(locale, "audit.emptyHint")}
              rows={rows}
              getRowKey={(row) => `${row.at}-${row.resource}-${row.resourceId ?? ""}`}
              columns={[
                {
                  key: "at",
                  header: t(locale, "admin.auditAt"),
                  emphasis: "primary",
                  render: (row) => <DateTime iso={row.at} locale={locale} />
                },
                {
                  key: "key",
                  header: t(locale, "settings.key"),
                  render: (row) => (row.resourceId ? <Ltr>{row.resourceId}</Ltr> : "—")
                },
                { key: "resource", header: t(locale, "audit.resource"), render: (row) => <Ltr>{row.resource}</Ltr> },
                { key: "action", header: t(locale, "audit.action"), render: (row) => <Ltr>{row.action}</Ltr> },
                {
                  key: "actor",
                  header: t(locale, "audit.actor"),
                  render: (row) =>
                    row.actorId ? (
                      <IdDisplay
                        id={row.actorId}
                        copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                      />
                    ) : (
                      "—"
                    )
                },
                { key: "role", header: t(locale, "admin.auditRole"), render: (row) => (row.role ? <Ltr>{row.role}</Ltr> : "—") }
              ]}
            />

            {/* EP-AC-060 returns metadata only — `before` and `after` are
                written to audit.audit_log by every config change and are not
                in the list response. Saying so is better than a column that
                is always empty. */}
            <p className="ps-field__hint">{t(locale, "audit.valuesNotReturned")}</p>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function ConfigAuditPage() {
  return (
    <LoginGate>
      <ConfigAuditInner />
    </LoginGate>
  );
}
