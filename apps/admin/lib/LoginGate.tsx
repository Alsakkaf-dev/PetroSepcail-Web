"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthShell, Banner, Skeleton, Stack } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { SignInForm } from "@petrospecial/app-shell/src/auth";
import { t } from "@petrospecial/i18n";
import { getToken, login } from "./authClient";

// The console has no /login route of its own — every page wraps itself in
// this gate — so the sign-in screen renders as a panel inside the shell
// rather than owning the viewport. Same card and same shared form as the
// driver's and the distributor's dedicated routes.
//
// Was: two unlabelled inputs, a `#b91c1c` error paragraph (that hex is
// --f-raval, the Raval product-family colour, pressed into service as an
// error red), hardcoded English, and a "Signing in..." string that was the
// whole app's only loading state. Sign-out moved to the shell, where one
// control serves every page instead of a floated 12px button per screen.
export function LoginGate({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const [token, setToken] = useState<string | null | undefined>(undefined);

  // undefined = localStorage not read yet. Rendering the form during that
  // moment flashes a sign-in screen at someone who is already signed in.
  useEffect(() => {
    setToken(getToken());
  }, []);

  // A full reload rather than a state update: the shell's own sign-out
  // control reads the token once on mount, so re-rendering only this subtree
  // would leave the console showing a signed-in page with no way out of it.
  // One reload keeps every part of the chrome agreeing about the session.
  const onSignedIn = useCallback(() => {
    window.location.reload();
  }, []);

  if (token === undefined) {
    return (
      <Stack gap="md">
        <Skeleton variant="block" size="lg" />
        <Skeleton width="1/2" />
      </Stack>
    );
  }

  if (!token) {
    return (
      <AuthShell
        variant="panel"
        title={t(locale, "auth.signInTitle")}
        lead={t(locale, "auth.leadAdmin")}
        footer={<Banner tone="warn">{t(locale, "auth.adminMonitored")}</Banner>}
      >
        <SignInForm
          signIn={({ email, password }) => login(email, password)}
          onSignedIn={onSignedIn}
          defaultEmail="admin.seed@petrospecial.internal"
        />
      </AuthShell>
    );
  }

  return <>{children}</>;
}
