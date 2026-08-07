"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AuthShell,
  Banner,
  Button,
  ButtonLink,
  Checkbox,
  Divider,
  Progress,
  Stack,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t, type StringKey } from "@petrospecial/i18n";
import { publicPost } from "../../lib/publicApi";

interface RegisterResponse {
  identityId: string;
  status: string;
  /** Present only while EMAIL_MODE=onscreen — the zero-vendor email fallback
   * ADR-20/D-13 designs and Section 3 of DEFERRED-DECISIONS keeps as the
   * default. When it is here, the link is the only way to finish. */
  verifyLink?: string;
}

/** Four cheap signals, deliberately not a password-strength library.
 *
 * A meter is guidance, not a gate — the server owns the actual policy — so
 * what matters is that it moves for the things that genuinely help and says
 * so in words. The bar alone would be a colour with no meaning. */
function strengthOf(password: string): { score: 0 | 1 | 2 | 3 | 4; labelKey: StringKey } {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/\d/.test(password) && /[a-zA-Z]/.test(password)) score += 1;
  if (/[^\w\s]/.test(password)) score += 1;
  const labels: StringKey[] = [
    "auth.strengthWeak",
    "auth.strengthWeak",
    "auth.strengthFair",
    "auth.strengthGood",
    "auth.strengthStrong"
  ];
  return { score: score as 0 | 1 | 2 | 3 | 4, labelKey: labels[score] ?? "auth.strengthWeak" };
}

// SCR-PC01-001 — the platform had no registration screen at all. EP-PC-001
// has existed since S04 and nothing in any app called it, so the only way to
// hold a customer account was to be seeded into one.
//
// Three rules the spec is explicit about and this screen carries:
//
// 1. **The card is capped at 26rem.** AuthShell owns that; this is the same
//    card the four sign-in screens use.
// 2. **Email and phone are LTR islands.** An email address set RTL beside
//    Arabic reorders around the @, and a +966 number reorders around the +.
// 3. **Service and privacy consent are required and marketing is separate.**
//    Not one combined checkbox, not a pre-ticked marketing box — the two
//    obligations are different in kind, and PDPL treats them differently.
export default function RegisterPage() {
  const locale = useLocale();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+966");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [service, setService] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RegisterResponse | null>(null);

  const strength = useMemo(() => strengthOf(password), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const consentsMissing = !service || !privacy;

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy) return;
      if (mismatch || consentsMissing) {
        setError(t(locale, mismatch ? "auth.passwordMismatch" : "auth.consentRequired"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        // EP-PC-001 takes name/email/phone/password/locale and nothing else —
        // there is no consent field on it, and `core.consents` is written
        // through the authenticated EP-SF-083, which needs a session this
        // customer does not have yet. Sending `marketingOptIn` anyway would
        // be stripped silently by the contract and read as recorded, so the
        // choice is carried to the confirmation panel in words instead.
        // See DEFERRED-DECISIONS §4 item 25.
        const result = await publicPost<RegisterResponse>(
          "/api/v1/auth/register",
          { fullName, email, phone, password, locale },
          locale
        );
        setDone(result);
      } catch (thrown) {
        setError(messageFor(locale, thrown));
      } finally {
        setBusy(false);
      }
    },
    [busy, consentsMissing, email, fullName, locale, mismatch, password, phone]
  );

  if (done) {
    return (
      <AuthShell variant="panel" title={t(locale, "auth.registered")} lead={t(locale, "auth.registeredHint")}>
        <Stack gap="md">
          <Banner tone="success" icon="check-circle">
            {t(locale, "auth.registeredHint")}
          </Banner>
          {marketing ? <Banner tone="info">{t(locale, "auth.marketingAtPrefs")}</Banner> : null}
          {done.verifyLink ? (
            // EMAIL_MODE=onscreen: no mail leaves the platform, so the link
            // is here or it is nowhere. Saying which mode this is stops it
            // reading as a leak.
            <Banner tone="info">
              <Stack gap="sm">
                <span>{t(locale, "auth.onScreenLink")}</span>
                <ButtonLink href={done.verifyLink} linkAs={Link} variant="dark" size="sm">
                  {t(locale, "auth.verifyTitle")}
                </ButtonLink>
              </Stack>
            </Banner>
          ) : null}
          <ButtonLink href="/account" linkAs={Link} variant="gold" size="lg">
            {t(locale, "auth.goToSignIn")}
          </ButtonLink>
        </Stack>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      variant="panel"
      title={t(locale, "auth.registerTitle")}
      lead={t(locale, "auth.registerLead")}
      footer={<Link href="/account">{t(locale, "auth.haveAccount")}</Link>}
    >
      <form onSubmit={onSubmit} noValidate>
        <Stack gap="md">
          {error ? <Banner tone="danger">{error}</Banner> : null}

          <TextField
            label={t(locale, "form.fullName")}
            name="fullName"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />

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

          <TextField
            label={t(locale, "form.phone")}
            type="tel"
            name="phone"
            autoComplete="tel"
            inputMode="tel"
            forceLtr
            required
            hint={t(locale, "auth.phoneHint")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <Stack gap="sm">
            <TextField
              label={t(locale, "form.password")}
              type="password"
              name="password"
              autoComplete="new-password"
              forceLtr
              required
              hint={t(locale, "auth.passwordHint")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {password.length > 0 ? (
              // The bar is the picture; `hint` is the meaning, and it is also
              // the bar's aria-valuetext, so "Fair" is what gets announced
              // rather than "2 of 4".
              <Progress
                value={strength.score}
                max={4}
                label={t(locale, "auth.passwordStrength")}
                tone={strength.score >= 3 ? "success" : "gold"}
                hint={t(locale, strength.labelKey)}
              />
            ) : null}
          </Stack>

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

          <Divider />

          <Stack gap="sm">
            <Checkbox
              label={t(locale, "auth.consentService")}
              name="consentService"
              required
              checked={service}
              onChange={(e) => setService(e.target.checked)}
            />
            <Checkbox
              label={t(locale, "auth.consentPrivacy")}
              name="consentPrivacy"
              required
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
            />
          </Stack>

          <Divider />

          {/* Marketing sits below its own rule, unticked, with a line saying
              it is optional. Bundling it with the service consent is exactly
              the pattern PDPL's "freely given, specific" wording rules out. */}
          <Checkbox
            label={t(locale, "auth.consentMarketing")}
            name="consentMarketing"
            description={t(locale, "auth.marketingSeparate")}
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
          />

          <Button type="submit" variant="gold" size="lg" busy={busy} disabled={consentsMissing}>
            {t(locale, "auth.createAccount")}
          </Button>
        </Stack>
      </form>
    </AuthShell>
  );
}
