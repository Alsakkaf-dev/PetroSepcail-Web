"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { MeResponse, MfaEnrollResponse } from "@petrospecial/contracts";
import { Badge, Banner, Button, ButtonLink, Card, Container, Page, Section, SectionHead, Skeleton, Stack, TextField } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../../lib/authClient";
import { LoginGate } from "../../../lib/LoginGate";

// SCR-AC-security-001 (built this session). EP-PC-008/009 have been callable
// since S02 with no screen anywhere ever calling them — the storefront's
// login form could ask for a TOTP code, but no admin had any way to enroll
// one. `apps/admin/lib/LoginGate.tsx` also silently dropped `totp` when
// submitting a challenged login (fixed alongside this screen), so MFA was
// unusable end to end for the one role pair it is required for.
//
// Re-enrolling always resets confirmation server-side (EP-PC-008's own
// upsert), so this screen never lets a click alone start a reset once MFA is
// already on — the current code has to be typed and verified first, the
// same re-auth-before-changing-a-security-boundary rule the API now enforces
// (services/api/src/routes/auth.ts).
function SecurityInner() {
  const locale = useLocale();
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  // Reset-authorization step (only reachable when me.mfaEnabled is true).
  const [resetCode, setResetCode] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Enrollment-in-progress step (first-time, or after a verified reset).
  const [enrollment, setEnrollment] = useState<MfaEnrollResponse | null>(null);
  const [viaReset, setViaReset] = useState(false);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [confirmCode, setConfirmCode] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(() => {
    setError(null);
    authedFetch<MeResponse>("/api/v1/me")
      .then(setMe)
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  async function startFirstEnrollment() {
    setEnrollBusy(true);
    setError(null);
    try {
      setEnrollment(await authedFetch<MfaEnrollResponse>("/api/v1/auth/mfa/enroll", { method: "POST" }));
      setViaReset(false);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setEnrollBusy(false);
    }
  }

  async function verifyCurrentAndStartReset() {
    setResetBusy(true);
    setResetError(null);
    try {
      setEnrollment(
        await authedFetch<MfaEnrollResponse>("/api/v1/auth/mfa/enroll", {
          method: "POST",
          body: JSON.stringify({ totp: resetCode })
        })
      );
      setViaReset(true);
      setResetCode("");
    } catch (thrown) {
      setResetError(messageFor(locale, thrown));
    } finally {
      setResetBusy(false);
    }
  }

  async function confirmEnrollment() {
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      await authedFetch("/api/v1/auth/mfa/confirm", { method: "POST", body: JSON.stringify({ totp: confirmCode }) });
      setDone(true);
      setEnrollment(null);
      load();
    } catch (thrown) {
      setConfirmError(messageFor(locale, thrown));
    } finally {
      setConfirmBusy(false);
    }
  }

  const secretKey = enrollment ? new URL(enrollment.otpauthUri).searchParams.get("secret") ?? "" : "";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="security-title">
        <Container width="narrow">
          <Stack gap="lg">
            <SectionHead level={1} titleId="security-title" title={t(locale, "settings.securityTitle")} />
            <Banner tone="info">{t(locale, "settings.securityHint")}</Banner>

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

            {me === undefined && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Skeleton variant="block" size="lg" />
              </div>
            ) : null}

            {me && !enrollment && !done ? (
              <Card>
                <Stack gap="md">
                  <Badge variant={me.mfaEnabled ? "success" : "warn"}>
                    {t(locale, me.mfaEnabled ? "settings.mfaEnabled" : "settings.mfaDisabled")}
                  </Badge>

                  {me.mfaEnabled ? (
                    <Stack gap="sm">
                      <p className="ps-field__hint">{t(locale, "settings.mfaResetHint")}</p>
                      {resetError ? <Banner tone="danger">{resetError}</Banner> : null}
                      <TextField
                        label={t(locale, "auth.totp")}
                        name="reset-totp"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        forceLtr
                        value={resetCode}
                        onChange={(e) => setResetCode(e.target.value)}
                      />
                      <Button variant="dark" busy={resetBusy} disabled={!resetCode} onClick={verifyCurrentAndStartReset}>
                        {t(locale, "settings.mfaResetCta")}
                      </Button>
                    </Stack>
                  ) : (
                    <Button variant="gold" busy={enrollBusy} onClick={startFirstEnrollment}>
                      {t(locale, "settings.mfaEnableCta")}
                    </Button>
                  )}
                </Stack>
              </Card>
            ) : null}

            {enrollment ? (
              <Card>
                <Stack gap="md">
                  {viaReset ? <Banner tone="success">{t(locale, "settings.mfaResetInProgress")}</Banner> : null}
                  <Banner tone="info">{t(locale, "settings.mfaSetupHint")}</Banner>

                  <TextField
                    label={t(locale, "settings.mfaOtpauthUri")}
                    name="otpauth-uri"
                    forceLtr
                    readOnly
                    value={enrollment.otpauthUri}
                  />
                  <TextField label={t(locale, "settings.mfaSecretKey")} name="secret-key" forceLtr readOnly value={secretKey} />

                  {confirmError ? <Banner tone="danger">{confirmError}</Banner> : null}

                  <TextField
                    label={t(locale, "auth.totp")}
                    name="confirm-totp"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    forceLtr
                    required
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                  />

                  <Button variant="gold" busy={confirmBusy} disabled={!confirmCode} onClick={confirmEnrollment}>
                    {t(locale, "settings.mfaConfirmCta")}
                  </Button>
                </Stack>
              </Card>
            ) : null}

            {done ? <Banner tone="success">{t(locale, "settings.mfaConfirmSuccess")}</Banner> : null}

            <ButtonLink linkAs={Link} href="/settings" variant="ghost">
              {t(locale, "common.back")}
            </ButtonLink>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function SecurityPage() {
  return (
    <LoginGate>
      <SecurityInner />
    </LoginGate>
  );
}
