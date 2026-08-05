"use client";

import { useCallback, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Banner, Button, Stack, TextField } from "@petrospecial/ui";
import { isApiError, messageFor, t } from "@petrospecial/i18n";
import { useLocale } from "./client";

export interface SignInCredentials {
  email: string;
  password: string;
  /** Present only once the API has asked for it. */
  totp?: string;
}

export interface SignInFormProps {
  /** The app's own `lib/authClient.ts` `login`, wrapped. Rejecting with an
   * `Error` is how it reports failure; the message is translated here. */
  signIn: (credentials: SignInCredentials) => Promise<unknown>;
  /** Where to go once the session exists. */
  onSignedIn: () => void;
  /** Pre-fills the email field — the seed account, in a dev-facing console. */
  defaultEmail?: string;
  /** Overrides the "دخول / Sign in" label where the button does more. */
  submitLabel?: string;
  /** Rendered between the fields and the button — a "remember me", a
   * "forgot password" link. */
  children?: ReactNode;
}

/**
 * `SCR-PC01-002` — the platform's one sign-in form.
 *
 * It replaces four divergent implementations: driver's (unstyled, and
 * horizontally overflowing the viewport on a phone), supplier's (three inline
 * style objects), the storefront's `LoginForm` (a hardcoded `#b91c1c` error,
 * which is the Raval product-family colour, not a status colour) and admin's
 * `LoginGate` (hardcoded English, no labels — only placeholders).
 *
 * Three things it does that none of those did:
 *
 * 1. **Real labels.** A placeholder is not a label: it disappears the moment
 *    you type, and screen readers treat it as a hint, not a name.
 * 2. **Translated failures.** The auth clients surface the API's English
 *    default message; `messageFor()` maps it back to its registry code and
 *    out through the AR/EN bundle, so an Arabic reader gets Arabic and
 *    "Login failed: 500" reaches nobody.
 * 3. **Conditional TOTP.** `MFA_REQUIRED` is an answer, not an error — the
 *    field appears, takes focus, and the message says what to do rather than
 *    reading as a rejection.
 *
 * The role picker `SCR-PC01-002` describes is deliberately absent: each of
 * the four apps is a single-role door, so there is nothing to pick. It
 * belongs with a unified sign-in route, if one is ever built.
 */
export function SignInForm({ signIn, onSignedIn, defaultEmail = "", submitLabel, children }: SignInFormProps) {
  const locale = useLocale();
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const totpRef = useRef<HTMLInputElement>(null);

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await signIn(needsTotp ? { email, password, totp } : { email, password });
        onSignedIn();
      } catch (thrown) {
        if (isApiError(thrown, "MFA_REQUIRED")) {
          setNeedsTotp(true);
          setError(messageFor(locale, thrown));
          // The field has just appeared; move to it rather than making
          // someone hunt for what changed on the screen.
          window.requestAnimationFrame(() => totpRef.current?.focus());
        } else {
          setLocked(isApiError(thrown, "ACCOUNT_LOCKED"));
          setError(messageFor(locale, thrown));
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, email, locale, needsTotp, onSignedIn, password, signIn, totp]
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap="md">
        {error ? (
          // `locked` is not a validation failure to fix by retyping, so it
          // reads as a state of the account rather than as a rejected field.
          <Banner tone={locked ? "warn" : "danger"} icon={locked ? "lock" : undefined}>
            {error}
          </Banner>
        ) : null}

        <TextField
          label={t(locale, "form.email")}
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          forceLtr
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <TextField
          label={t(locale, "form.password")}
          type="password"
          name="password"
          autoComplete="current-password"
          forceLtr
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {needsTotp ? (
          <TextField
            ref={totpRef}
            label={t(locale, "auth.totp")}
            name="totp"
            autoComplete="one-time-code"
            inputMode="numeric"
            forceLtr
            required
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
          />
        ) : null}

        {children}

        <Button type="submit" variant="gold" size="lg" busy={busy}>
          {submitLabel ?? t(locale, "common.signIn")}
        </Button>
      </Stack>
    </form>
  );
}
