"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Icon } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import { clearToken, getToken } from "../lib/authClient";

// Sign-out was a `float: inline-end` 12px button that LoginGate rendered
// above whichever page happened to be open. It belongs to the shell, once.
//
// It renders nothing when there is no session — a "Sign out" control above a
// sign-in form is noise. The token lives in localStorage, so that is a
// client-only decision and the control appears after hydration rather than
// flashing and disappearing.
export function SignOutButton() {
  const locale = useLocale();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
  }, []);

  // A reload rather than a route change: the console has no /login route, and
  // each page's own LoginGate holds the session in its own state. Reloading
  // is the one thing that puts every part of the chrome back in agreement.
  const onSignOut = useCallback(() => {
    clearToken();
    window.location.reload();
  }, []);

  if (!signedIn) return null;

  return (
    <Button variant="ghost" size="sm" onClick={onSignOut} leadingIcon={<Icon name="log-out" size="sm" />}>
      {t(locale, "common.signOut")}
    </Button>
  );
}
