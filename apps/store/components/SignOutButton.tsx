"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Icon } from "@petrospecial/ui";
import { useIdleTimeout } from "@petrospecial/app-shell/src/idleTimeout";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import { getToken, logout } from "../lib/authClient";

// 04-roles-and-permissions-matrix.md §1: 30 min idle timeout for customer
// sessions. Never enforced anywhere before this — see useIdleTimeout's own
// comment for why it lives client-side.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// No sign-out control existed anywhere in this app — clearToken() was only
// ever reached automatically, from inside authedFetch on an unrecoverable
// 401. A signed-in customer had no way to end their own session; on a shared
// device that means the next person to open the browser resumes as them.
//
// Renders nothing signed out, same as HeaderBell — a "Sign out" control next
// to an inline LoginForm is noise. A reload rather than a route change: the
// storefront has no single /login route, each page renders its own inline
// form when signed out, and a reload is what puts every open page back in
// agreement about the session, same reasoning as apps/admin's LoginGate.
export function SignOutButton() {
  const locale = useLocale();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
  }, []);

  const onSignOut = useCallback(() => {
    void logout().finally(() => window.location.reload());
  }, []);

  useIdleTimeout(signedIn, IDLE_TIMEOUT_MS, onSignOut);

  if (!signedIn) return null;

  return (
    <Button variant="ghost" size="sm" onClick={onSignOut} leadingIcon={<Icon name="log-out" size="sm" />}>
      {t(locale, "common.signOut")}
    </Button>
  );
}
