"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import { clearToken, getToken } from "../lib/authClient";

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
    clearToken();
    setSignedIn(false);
    router.push("/login");
  }, [router]);

  if (!signedIn) return null;

  return (
    <Button variant="ghost" size="sm" onClick={onSignOut} leadingIcon={<Icon name="log-out" size="sm" />}>
      {t(locale, "common.signOut")}
    </Button>
  );
}
