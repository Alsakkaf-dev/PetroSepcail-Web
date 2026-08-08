"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon } from "@petrospecial/ui";
import { useIdleTimeout } from "@petrospecial/app-shell/src/idleTimeout";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import { getToken, logout } from "../lib/authClient";

// 04-roles-and-permissions-matrix.md §1: 30 min idle timeout for driver
// sessions. Never enforced anywhere before this — see useIdleTimeout's own
// comment for why it lives client-side.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// No sign-out control existed anywhere in this app. A driver who finished a
// shift had no way to end their own session — the only path off a signed-in
// screen was a session simply expiring on its own. On a device handed to a
// different driver for the next shift, that left the previous driver's
// session live until it happened to time out.
//
// Renders nothing signed out — the login page is a bareRoute (no shell
// chrome at all), so this never has to coexist with the sign-in form.
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
