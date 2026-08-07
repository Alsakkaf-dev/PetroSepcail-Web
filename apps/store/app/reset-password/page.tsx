"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell, Banner, Button, ButtonLink, Stack, TextField } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { publicPost } from "../../lib/publicApi";

export const dynamic = "force-dynamic";

// SCR-PC01-003, second half. One route, two jobs, decided by whether the URL
// carries a token:
//
//  - no token  -> ask for the email and request a link (EP-PC-006)
//  - a token   -> set the new password (EP-PC-007)
//
// They are one screen because they are one errand, and because the link the
// first step sends lands on the second.
export default function ResetPasswordPage() {
  const locale = useLocale();
  const params = useSearchParams();
  const token = params.get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [changed, setChanged] = useState(false);

  const mismatch = useMemo(() => confirm.length > 0 && confirm !== password, [confirm, password]);

  const requestLink = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await publicPost("/api/v1/auth/password-reset/request", { email }, locale);
      } catch (thrown) {
        setError(messageFor(locale, thrown));
        setBusy(false);
        return;
      }
      // EP-PC-006 answers 202 whether or not the address exists, on purpose:
      // a different answer for a registered address is an account-enumeration
      // oracle. The confirmation is worded to match that — "if that email is
      // registered" — rather than claiming a message was sent.
      setSent(true);
      setBusy(false);
    },
    [busy, email, locale]
  );

  const setNewPassword = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy) return;
      if (mismatch) {
        setError(t(locale, "auth.passwordMismatch"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await publicPost("/api/v1/auth/password-reset/confirm", { token, newPassword: password }, locale);
        setChanged(true);
      } catch (thrown) {
        setError(messageFor(locale, thrown));
      } finally {
        setBusy(false);
      }
    },
    [busy, locale, mismatch, password, token]
  );

  if (changed) {
    return (
      <AuthShell variant="panel" title={t(locale, "auth.resetTitle")}>
        <Stack gap="md">
          <Banner tone="success" icon="check-circle">
            {t(locale, "auth.resetSuccess")}
          </Banner>
          <ButtonLink href="/account" linkAs={Link} variant="gold" size="lg">
            {t(locale, "auth.goToSignIn")}
          </ButtonLink>
        </Stack>
      </AuthShell>
    );
  }

  if (token) {
    return (
      <AuthShell variant="panel" title={t(locale, "auth.resetTitle")}>
        <form onSubmit={setNewPassword} noValidate>
          <Stack gap="md">
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <TextField
              label={t(locale, "auth.newPassword")}
              type="password"
              name="newPassword"
              autoComplete="new-password"
              forceLtr
              required
              hint={t(locale, "auth.passwordHint")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField
              label={t(locale, "auth.confirmPassword")}
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              forceLtr
              required
              error={mismatch ? t(locale, "auth.passwordMismatch") : undefined}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <Button type="submit" variant="gold" size="lg" busy={busy}>
              {t(locale, "auth.resetSubmit")}
            </Button>
          </Stack>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      variant="panel"
      title={t(locale, "auth.resetTitle")}
      lead={t(locale, "auth.resetLead")}
      footer={<Link href="/account">{t(locale, "auth.goToSignIn")}</Link>}
    >
      <form onSubmit={requestLink} noValidate>
        <Stack gap="md">
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {sent ? <Banner tone="info">{t(locale, "auth.resetSent")}</Banner> : null}
          <TextField
            label={t(locale, "form.email")}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            forceLtr
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" variant="gold" size="lg" busy={busy}>
            {t(locale, "auth.resetRequest")}
          </Button>
        </Stack>
      </form>
    </AuthShell>
  );
}
