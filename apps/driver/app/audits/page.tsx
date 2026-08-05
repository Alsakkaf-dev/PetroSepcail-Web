"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AuditListResponse } from "@petrospecial/contracts";
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  Container,
  DataList,
  DateTime,
  Page,
  Section,
  SectionHead,
  Stack
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";

type Audit = AuditListResponse["items"][number];

// SCR-DL06-001, the list — EP-DL-070. Zero-tolerance by design: any variance
// closes the count as an exception (delivery.close_audit) rather than
// accepting it.
//
// Was a `<ul>` of "8/5/2026, 10:14:00 AM — open" with a button after it.
export default function AuditsPage() {
  const locale = useLocale();
  const [items, setItems] = useState<Audit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<AuditListResponse>("/api/v1/driver/audits")
      .then((res) => setItems(res.items))
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  const state = error ? "error" : items === null ? "loading" : items.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="audits-title">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="audits-title"
              title={t(locale, "driver.audits")}
              lead={t(locale, "driver.expectedHidden")}
            />

            {error ? <Banner tone="danger">{error}</Banner> : null}

            <DataList
              label={t(locale, "driver.audits")}
              state={state}
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "driver.noAudits")}
              emptyDescription={t(locale, "driver.noAuditsHint")}
              emptyAction={
                <ButtonLink linkAs={Link} href="/shift" variant="gold">
                  {t(locale, "nav.shift")}
                </ButtonLink>
              }
              items={(items ?? []).map((audit) => ({
                id: audit.auditId,
                title: <DateTime iso={audit.openedAt} locale={locale} />,
                status: <Badge variant={audit.status === "open" ? "warn" : "neutral"}>{audit.status}</Badge>,
                fields: [{ label: t(locale, "driver.auditOpenedAt"), value: <DateTime iso={audit.openedAt} locale={locale} /> }],
                actions:
                  audit.status === "open" ? (
                    <ButtonLink linkAs={Link} href={`/audits/${audit.auditId}`} variant="gold">
                      {t(locale, "driver.countAudit")}
                    </ButtonLink>
                  ) : null
              }))}
            />

            {error ? (
              <Button variant="ghost" size="sm" onClick={load}>
                {t(locale, "common.retry")}
              </Button>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
