"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuditListResponse } from "@petrospecial/contracts";
import { authedFetch } from "../../lib/authClient";
import { t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

// EP-DL-070 (DL-06, S12) — the driver's own stock-audit history + any open
// audit due for counting. Zero-tolerance: any variance closes the audit as
// 'exception' (delivery.close_audit, 0050) rather than accepting it.
export default function AuditsPage() {
  return (
    <Suspense fallback={null}>
      <AuditsPageInner />
    </Suspense>
  );
}

function AuditsPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<AuditListResponse["items"] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<AuditListResponse>("/api/v1/driver/audits")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }, [locale]);

  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"}>
      <h1>{t(locale, "audits")}</h1>
      {error && <p role="alert">{error}</p>}
      {items === undefined ? (
        <p>{t(locale, "loading")}</p>
      ) : items.length === 0 ? (
        <p>{t(locale, "noAudits")}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.auditId}>
              {new Date(item.openedAt).toLocaleString(locale)} — {item.status}
              {item.status === "open" && (
                <button onClick={() => router.push(`/audits/${item.auditId}?lang=${locale}`)}>{t(locale, "countAudit")}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
