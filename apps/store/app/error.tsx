"use client";

import { RouteError } from "@petrospecial/app-shell/src/routeStates";

// A thrown error inside this segment. The error's own message is never
// rendered — it is a developer string, and when it does come from the API it
// is English whoever is reading. reset() is Next's real re-render, so the
// retry actually retries.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} />;
}
