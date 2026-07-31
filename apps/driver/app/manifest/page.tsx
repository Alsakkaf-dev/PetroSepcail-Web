"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ManifestResponse } from "@petrospecial/contracts";
import { authedFetch } from "../../lib/authClient";
import { t, type Locale } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

// EP-DL-010 (DL-01, S10) — the typed manifest, grouped by stop_type per
// D-14's unified-handling model. No prices anywhere (04-roles §3).
export default function ManifestPage() {
  return (
    <Suspense fallback={null}>
      <ManifestPageInner />
    </Suspense>
  );
}

function stopTypeLabel(locale: Locale, stopType: string): string {
  if (stopType === "b2b_drop") return t(locale, "b2bDrop");
  if (stopType === "b2c_pickup") return t(locale, "b2cPickup");
  return t(locale, "b2cHome");
}

function ManifestPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [stops, setStops] = useState<ManifestResponse["stops"] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<ManifestResponse>("/api/v1/driver/manifest")
      .then((res) => setStops(res.stops))
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }, [locale]);

  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"}>
      <h1>{t(locale, "manifest")}</h1>
      {error && <p role="alert">{error}</p>}
      {stops === undefined ? (
        <p>{t(locale, "loading")}</p>
      ) : stops.length === 0 ? (
        <p>{t(locale, "noTasks")}</p>
      ) : (
        <ul>
          {stops.map((stop) => (
            <li key={stop.taskId}>
              <strong>{stopTypeLabel(locale, stop.stopType)}</strong> — {stop.destination.label} ({stop.status})
              <button onClick={() => router.push(`/task/${stop.taskId}?lang=${locale}`)}>{t(locale, "viewTask")}</button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
