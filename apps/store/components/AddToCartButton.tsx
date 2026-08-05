"use client";

import { useCallback, useState } from "react";
import { Button, Icon, InlineError } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken, NETWORK_ERROR, SESSION_EXPIRED } from "../lib/authClient";

// Was a hand-rolled gold rectangle carrying its own private AR/EN dictionary —
// the one component-local dictionary in the platform — and a `#b91c1c` error
// line, which is --f-raval, the Raval product family, standing in for an
// error red.
//
// The failure text now comes from the API error registry through the shared
// bundle, so an out-of-stock line, a quantity cap and an expired session each
// say what actually happened instead of one blanket "Could not add".
export function AddToCartButton({ packSizeId, disabled }: { packSizeId: string; disabled?: boolean }) {
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "busy" | "added">("idle");
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(async () => {
    setError(null);
    if (!getToken()) {
      setError(t(locale, "error.notLoggedIn"));
      return;
    }
    setState("busy");
    try {
      await authedFetch("/api/v1/cart/lines", { method: "POST", body: JSON.stringify({ packSizeId, qty: 1 }) });
      setState("added");
    } catch (thrown) {
      setState("idle");
      const message = thrown instanceof Error ? thrown.message : "";
      if (message === SESSION_EXPIRED || message === "NOT_LOGGED_IN") setError(t(locale, "auth.sessionExpired"));
      else if (message === NETWORK_ERROR) setError(t(locale, "error.network"));
      else setError(messageFor(locale, thrown));
    }
  }, [locale, packSizeId]);

  return (
    <>
      <Button
        variant="gold"
        size="sm"
        onClick={add}
        busy={state === "busy"}
        disabled={disabled || state === "added"}
        leadingIcon={<Icon name={state === "added" ? "check" : "cart"} size="sm" />}
      >
        {state === "added" ? t(locale, "product.added") : t(locale, "product.addToCart")}
      </Button>
      {error ? <InlineError>{error}</InlineError> : null}
    </>
  );
}
