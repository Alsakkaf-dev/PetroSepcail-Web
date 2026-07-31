"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ShiftResponse } from "@petrospecial/contracts";
import { authedFetch } from "../../lib/authClient";
import { t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

// EP-DL-001/002 (DL-07, S11) — shows the driver's current shift, or a
// minimal load-out form if none is open. Van/pack-size selection here is a
// single plate + a fixed demo pack-size line rather than a full multi-line
// stock picker (SP-04/AC-02's own catalog admin UI is the pattern a richer
// picker would follow; out of scope for this pass — the API itself accepts
// a full `load: [{packSizeId, qty}]` array, this form just doesn't expose one).
export default function ShiftPage() {
  return (
    <Suspense fallback={null}>
      <ShiftPageInner />
    </Suspense>
  );
}

function ShiftPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [shift, setShift] = useState<ShiftResponse | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<ShiftResponse>("/api/v1/driver/shift")
      .then(setShift)
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }, [locale]);

  if (shift === undefined) return <p>{t(locale, "loading")}</p>;

  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"}>
      <h1>{t(locale, "startShift")}</h1>
      {error && <p role="alert">{error}</p>}
      {shift ? (
        <div>
          <p>{t(locale, "vanPlate")}: {shift.vanId}</p>
          <button onClick={() => router.push(`/manifest?lang=${locale}`)}>{t(locale, "goToManifest")}</button>
        </div>
      ) : (
        <p>{t(locale, "noShift")}</p>
      )}
    </main>
  );
}
