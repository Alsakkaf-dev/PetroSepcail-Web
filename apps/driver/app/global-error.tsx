"use client";

import { GlobalErrorScreen } from "@petrospecial/app-shell/src/routeStates";
import "./globals.css";

// The root layout itself threw, so this replaces the whole document —
// including the stylesheet the layout imports, which is why it is imported
// again here.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <GlobalErrorScreen error={error} reset={reset} />;
}
