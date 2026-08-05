"use client";

import type { AdminReadCustomerResponse } from "@petrospecial/contracts";
import { useState } from "react";
import {
  Banner,
  Button,
  Card,
  Container,
  Ltr,
  Page,
  Section,
  SectionHead,
  Stack,
  SummaryPanel,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

// SCR-AC10-001 — AC-10. The only surface on the platform where customer PII
// can be read.
//
// Everything about it is a constraint, and every constraint is now visible
// rather than merely true:
//
//  * One customer id, which has to be known already. There is no search by
//    name, no search by phone, no wildcard, no list.
//  * A reason, mandatory, stored in the audit log with the access.
//  * A --flame banner saying the access will be recorded against your name,
//    shown before the form rather than after the lookup.
//  * No export control anywhere on the screen.
//
// Was eight inline styles, a heading reading "Privacy — Single-Record PII
// Lookup (AC-10)", a muted grey sentence where the warning should be, and a
// `#b91c1c` error line.
function PrivacyInner() {
  const locale = useLocale();
  const [customerId, setCustomerId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<AdminReadCustomerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await authedFetch<AdminReadCustomerResponse>("/api/v1/admin/customers/read", {
          method: "POST",
          body: JSON.stringify({ customerId, reason })
        })
      );
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="privacy-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="privacy-title" title={t(locale, "nav.privacy")} />

            {/* The warning comes before the field, not after the lookup. */}
            <Banner tone="warn" title={t(locale, "admin.piiWarning")}>
              {t(locale, "admin.piiNoExport")}
            </Banner>

            <Card>
              <form onSubmit={lookup}>
                <Stack gap="md">
                  <TextField
                    label={t(locale, "admin.customerId")}
                    hint={t(locale, "admin.customerIdHint")}
                    required
                    forceLtr
                    autoComplete="off"
                    value={customerId}
                    onChange={(event) => setCustomerId(event.target.value)}
                  />
                  <TextField
                    label={t(locale, "admin.piiReasonLabel")}
                    hint={t(locale, "admin.allActionsLogged")}
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  {error ? <Banner tone="danger">{error}</Banner> : null}
                  <Button type="submit" variant="gold" busy={busy} disabled={!customerId || !reason.trim()}>
                    {busy ? t(locale, "admin.lookingUp") : t(locale, "admin.lookup")}
                  </Button>
                </Stack>
              </form>
            </Card>

            {result ? (
              <Card>
                <SummaryPanel
                  label={t(locale, "admin.piiResult")}
                  rows={[
                    { id: "name", label: t(locale, "form.fullName"), value: result.fullName },
                    { id: "phone", label: t(locale, "form.phone"), value: <Ltr>{result.phone}</Ltr> },
                    { id: "email", label: t(locale, "form.email"), value: <Ltr>{result.email}</Ltr> },
                    { id: "status", label: t(locale, "admin.outcome"), value: result.status }
                  ]}
                >
                  {/* No export, no copy-all, no "open in..." — the record is
                      read on screen and nowhere else. */}
                  <p className="ps-line-note ps-line-note--muted">{t(locale, "admin.piiNoExport")}</p>
                </SummaryPanel>
              </Card>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function PrivacyPage() {
  return (
    <LoginGate>
      <PrivacyInner />
    </LoginGate>
  );
}
