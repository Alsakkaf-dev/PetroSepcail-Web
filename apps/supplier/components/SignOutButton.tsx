"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon } from "@petrospecial/ui";
import { useIdleTimeout } from "@petrospecial/app-shell/src/idleTimeout";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import { getToken, logout } from "../lib/authClient";

// 04-roles-and-permissions-matrix.md §1: 30 min idle timeout for supplier
// sessions. Never enforced anywhere before this — see useIdleTimeout's own
// comment for why it lives client-side.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Sign-out used to be a plain <button> repeated in the nav row every page
// rendered for itself. It belongs to the shell, once.
//
// It renders nothing at all when there is no session — a "Sign out" control
// on the sign-in screen is noise. The token lives in localStorage, so that is
// a client-only decision and the button appears after hydration rather than
// flashing and disappearing.
export function SignOutButton() {
  const locale = useLocale();
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
  }, []);

  const onSignOut = useCallback(() => {
    setSignedIn(false);
    void logout().finally(() => router.push("/login"));
  }, [router]);

  useIdleTimeout(signedIn, IDLE_TIMEOUT_MS, onSignOut);

  if (!signedIn) return null;

  return (
    <Button variant="ghost" size="sm" onClick={onSignOut} leadingIcon={<Icon name="log-out" size="sm" />}>
      {t(locale, "common.signOut")}
    </Button>
  );
}
