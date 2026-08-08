"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Icon } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import { getToken, logout } from "../lib/authClient";

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

  if (!signedIn) return null;

  return (
    <Button variant="ghost" size="sm" onClick={onSignOut} leadingIcon={<Icon name="log-out" size="sm" />}>
      {t(locale, "common.signOut")}
    </Button>
  );
}
