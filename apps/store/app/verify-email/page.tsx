"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell, Banner, ButtonLink, Skeleton, Stack } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { publicPost } from "../../lib/publicApi";

// A token in the URL is the whole input, so this route reads
// `useSearchParams()` and is dynamic by declaration rather than by being
// wrapped in a <Suspense fallback={null}> — the pattern /returns established
// and the 27 wrapper files this overhaul deleted.
export const dynamic = "force-dynamic";

type State = "checking" | "done" | "failed";

// SCR-PC01-003, first half — the landing page for the link EP-PC-001 mints.
// It has existed since S04 and had nowhere to land: `PUBLIC_BASE_URL` +
// `/verify-email?token=…` pointed at a 404 in every environment.
export default function VerifyEmailPage() {
  const locale = useLocale();
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("failed");
      setError(t(locale, "auth.tokenMissing"));
      return;
    }
    let cancelled = false;
    publicPost("/api/v1/auth/verify-email", { token }, locale)
      .then(() => {
        if (!cancelled) setState("done");
      })
      .catch((thrown) => {
        if (cancelled) return;
        setState("failed");
        // TOKEN_INVALID covers expired, consumed and forged alike — the
        // registry's own wording, deliberately not three different messages
        // that would tell an attacker which one it was.
        setError(messageFor(locale, thrown));
      });
    return () => {
      cancelled = true;
    };
  }, [locale, token]);

  return (
    <AuthShell variant="panel" title={t(locale, "auth.verifyTitle")} lead={t(locale, "auth.verifyLead")}>
      <Stack gap="md">
        {state === "checking" ? (
          <div role="status" aria-live="polite" aria-busy="true">
            <span className="ps-visually-hidden">{t(locale, "auth.verifying")}</span>
            <Stack gap="sm">
              <Skeleton variant="block" size="lg" />
              <Skeleton width="1/2" />
            </Stack>
          </div>
        ) : null}

        {state === "done" ? (
          <>
            <Banner tone="success" icon="check-circle">
              {t(locale, "auth.verifySuccess")}
            </Banner>
            <ButtonLink href="/account" linkAs={Link} variant="gold" size="lg">
              {t(locale, "auth.goToSignIn")}
            </ButtonLink>
          </>
        ) : null}

        {state === "failed" ? (
          <>
            <Banner tone="danger">{error ?? t(locale, "auth.verifyFailed")}</Banner>
            {/* No "resend" control: EP-PC-001 is the only endpoint that mints
                a verification token, and calling it again would create a
                second account. Registering again is the honest route back. */}
            <ButtonLink href="/register" linkAs={Link} variant="dark" size="lg">
              {t(locale, "auth.registerCta")}
            </ButtonLink>
          </>
        ) : null}
      </Stack>
    </AuthShell>
  );
}
