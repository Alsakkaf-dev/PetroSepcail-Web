"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Container,
  Countdown,
  DateTime,
  Divider,
  JsonView,
  Page,
  Section,
  SectionHead,
  Stack,
  Switch
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t, type Locale, type StringKey } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../../lib/authClient";
import { LoginForm } from "../../../components/LoginForm";

type Channel = "email" | "web_push" | "sms";

interface PreferenceItem {
  notificationType: string;
  channel: Channel;
  enabled: boolean;
}

interface ConsentItem {
  kind: "service_terms" | "privacy" | "marketing";
  granted: boolean;
  policyVersion: string;
  at: string;
}

interface ExportResponse {
  generatedAt: string;
  identity: Record<string, unknown>;
  addresses: Record<string, unknown>[];
  orders: Record<string, unknown>[];
}

interface DeleteResponse {
  status: string;
  purgeAfter: string;
}

const CHANNEL_LABEL: Record<Channel, StringKey> = {
  email: "prefs.channelEmail",
  web_push: "prefs.channelWebPush",
  sms: "prefs.channelSms"
};

/** Remaining time, at the coarsest unit that still says something useful.
 * Thirty days out, seconds are noise; ten minutes out, they are the point. */
function remaining(locale: Locale, parts: { days: number; hours: number; minutes: number; seconds: number }): string {
  if (parts.days > 0) {
    return t(locale, "common.remainingDays", { days: count(parts.days), hours: count(parts.hours) });
  }
  if (parts.hours > 0) {
    return t(locale, "common.remainingHours", { hours: count(parts.hours), minutes: count(parts.minutes) });
  }
  return t(locale, "common.remainingMinutes", { minutes: count(parts.minutes), seconds: count(parts.seconds) });
}

const CONSENT_LABEL: Record<ConsentItem["kind"], StringKey> = {
  service_terms: "auth.consentService",
  privacy: "auth.consentPrivacy",
  marketing: "auth.consentMarketing"
};

// SCR-SF10-002 — preferences and privacy. EP-SF-082/083/084 and EP-PC-010
// have all been callable since S09 and none of them had a screen, so a
// customer could neither see what they had consented to, turn a channel off,
// take their data, nor ask to be deleted.
//
// The four rules this screen exists to carry:
//
// 1. **In-app notifications are always on and cannot be turned off.** The
//    contract leaves `in_app` out of the channel enum on purpose. It renders
//    here as a locked switch with the reason beside it, not as an omission —
//    "why can't I turn this off" needs an answer on the screen.
// 2. **Consent carries its version and its date.** A consent with no version
//    is not evidence of anything.
// 3. **Marketing can be withdrawn, and only marketing.** The other two are a
//    condition of holding the account, and the endpoint accepts no others.
// 4. **Deletion is a 30-day grace period, counted down.**
function PreferencesInner() {
  const locale = useLocale();
  const [prefs, setPrefs] = useState<PreferenceItem[] | null>(null);
  const [consents, setConsents] = useState<ConsentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState<ExportResponse | null>(null);
  const [deleteAck, setDeleteAck] = useState(false);
  const [deletion, setDeletion] = useState<DeleteResponse | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      authedFetch<{ items: PreferenceItem[] }>("/api/v1/account/notification-preferences"),
      authedFetch<{ items: ConsentItem[] }>("/api/v1/account/consents")
    ])
      .then(([p, c]) => {
        setPrefs(p.items);
        setConsents(c.items);
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  const toggle = useCallback(
    async (item: PreferenceItem, enabled: boolean) => {
      setSaved(false);
      const next = (prefs ?? []).map((p) =>
        p.notificationType === item.notificationType && p.channel === item.channel ? { ...p, enabled } : p
      );
      setPrefs(next);
      try {
        const result = await authedFetch<{ items: PreferenceItem[] }>("/api/v1/account/notification-preferences", {
          method: "PUT",
          body: JSON.stringify({ items: [{ ...item, enabled }] })
        });
        setPrefs(result.items);
        setSaved(true);
      } catch (thrown) {
        setError(messageFor(locale, thrown));
        // The switch already moved; put it back rather than leaving the
        // screen claiming a preference the server never stored.
        setPrefs(prefs);
      }
    },
    [locale, prefs]
  );

  const withdrawMarketing = useCallback(async () => {
    setBusy(true);
    try {
      await authedFetch("/api/v1/account/consents", { method: "PATCH", body: JSON.stringify({ marketing: false }) });
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }, [load, locale]);

  const exportData = useCallback(async () => {
    setBusy(true);
    try {
      setExported(await authedFetch<ExportResponse>("/api/v1/account/export", { method: "POST", body: "{}" }));
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }, [locale]);

  const requestDeletion = useCallback(async () => {
    setBusy(true);
    try {
      setDeletion(await authedFetch<DeleteResponse>("/api/v1/auth/account/delete", { method: "POST", body: "{}" }));
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }, [locale]);

  const marketing = consents?.find((c) => c.kind === "marketing");

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="prefs-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="prefs-title" title={t(locale, "prefs.title")} />

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

            {/* ---- channels ------------------------------------------- */}
            <Card>
              <Stack gap="md">
                <h2 className="ps-section-head__title">{t(locale, "prefs.channels")}</h2>

                {/* Locked, on, and told why. `in_app` is deliberately not in
                    the channel enum — this is the one control on the screen
                    whose state the customer cannot change, so it says so. */}
                <Switch
                  label={t(locale, "prefs.channelInApp")}
                  lockedReason={t(locale, "prefs.inAppLocked")}
                  checked
                  disabled
                  onChange={() => {}}
                />

                <Divider />

                {prefs === null ? (
                  <p className="ps-field__hint">{t(locale, "common.loading")}</p>
                ) : prefs.length === 0 ? (
                  <Banner tone="info" title={t(locale, "prefs.noPreferences")}>
                    {t(locale, "prefs.noPreferencesHint")}
                  </Banner>
                ) : (
                  <Stack gap="sm">
                    {prefs.map((item) => (
                      <Switch
                        key={`${item.notificationType}-${item.channel}`}
                        label={`${t(locale, CHANNEL_LABEL[item.channel])} — ${item.notificationType}`}
                        checked={item.enabled}
                        onChange={(next) => toggle(item, next)}
                      />
                    ))}
                    <p className="ps-field__hint">{t(locale, "prefs.defaultsNote")}</p>
                  </Stack>
                )}

                {saved ? (
                  <Banner tone="success" icon="check-circle">
                    {t(locale, "prefs.saved")}
                  </Banner>
                ) : null}
              </Stack>
            </Card>

            {/* ---- consents ------------------------------------------- */}
            <Card>
              <Stack gap="md">
                <h2 className="ps-section-head__title">{t(locale, "account.consentsTitle")}</h2>

                {consents === null ? (
                  <p className="ps-field__hint">{t(locale, "common.loading")}</p>
                ) : (
                  <Stack gap="sm">
                    {consents.map((consent) => (
                      <Stack key={consent.kind} gap="xs">
                        <span>
                          {t(locale, CONSENT_LABEL[consent.kind])} —{" "}
                          {t(locale, consent.granted ? "account.consentGranted" : "account.consentWithdrawn")}
                        </span>
                        <span className="ps-field__hint">
                          {t(locale, "prefs.consentVersion", { version: consent.policyVersion })} ·{" "}
                          <DateTime iso={consent.at} locale={locale} />
                        </span>
                      </Stack>
                    ))}
                  </Stack>
                )}

                <p className="ps-field__hint">{t(locale, "prefs.consentLocked")}</p>

                {marketing?.granted ? (
                  <Button variant="dark" busy={busy} onClick={withdrawMarketing}>
                    {t(locale, "prefs.withdrawMarketing")}
                  </Button>
                ) : consents !== null ? (
                  <Banner tone="info">{t(locale, "prefs.marketingWithdrawn")}</Banner>
                ) : null}
              </Stack>
            </Card>

            {/* ---- data export ---------------------------------------- */}
            <Card>
              <Stack gap="md">
                <h2 className="ps-section-head__title">{t(locale, "prefs.exportTitle")}</h2>
                <p className="ps-field__hint">{t(locale, "prefs.exportHint")}</p>
                <Button variant="dark" busy={busy} onClick={exportData}>
                  {t(locale, "prefs.exportTitle")}
                </Button>
                {exported ? (
                  <Stack gap="sm">
                    <Banner tone="success" icon="check-circle">
                      {t(locale, "prefs.exportReady")}
                    </Banner>
                    {/* EP-SF-084 answers synchronously with the payload rather
                        than a download URL (its own SPEC-GAP note says so), so
                        the export is shown as what it is: readable, selectable
                        and copyable text, redaction list applied. */}
                    <JsonView
                      label={t(locale, "prefs.exportTitle")}
                      value={exported}
                    />
                  </Stack>
                ) : null}
              </Stack>
            </Card>

            {/* ---- deletion ------------------------------------------- */}
            <Card>
              <Stack gap="md">
                <h2 className="ps-section-head__title">{t(locale, "prefs.deleteTitle")}</h2>

                {deletion ? (
                  <Stack gap="sm">
                    <Banner tone="warn" icon="clock" title={t(locale, "prefs.deleteRequested")}>
                      {t(locale, "prefs.deleteHint")}
                    </Banner>
                    <Countdown
                      deadline={deletion.purgeAfter}
                      label={t(locale, "prefs.deleteRemaining")}
                      expiredLabel={t(locale, "prefs.deleteTitle")}
                      format={(parts) => remaining(locale, parts)}
                      // Thirty days. The default hour-long urgency threshold
                      // would leave this reading calm right up to the last
                      // afternoon; a day out is when it starts to matter.
                      urgentBelowMs={24 * 60 * 60 * 1000}
                    />
                  </Stack>
                ) : (
                  <Stack gap="md">
                    <Banner tone="warn" icon="warning">
                      {t(locale, "prefs.deleteHint")}
                    </Banner>
                    <Checkbox
                      label={t(locale, "prefs.deleteConfirm")}
                      name="deleteAck"
                      checked={deleteAck}
                      onChange={(e) => setDeleteAck(e.target.checked)}
                    />
                    <Button variant="danger" busy={busy} disabled={!deleteAck} onClick={requestDeletion}>
                      {t(locale, "prefs.deleteSubmit")}
                    </Button>
                  </Stack>
                )}
              </Stack>
            </Card>

            <Link href="/account">{t(locale, "account.title")}</Link>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function PreferencesPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => setSignedIn(Boolean(getToken())), []);
  if (signedIn === null) return null;
  if (!signedIn) return <LoginForm promptKey="auth.leadAccount" onLoggedIn={() => setSignedIn(true)} />;
  return <PreferencesInner />;
}
