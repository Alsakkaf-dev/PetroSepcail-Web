"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface CustodyItem {
  custodyRef: string;
  orderId: string;
  amount: string;
  status: "held" | "remitted";
  collectedAt: string;
  remittedAt: string | null;
}
interface CustodyResponse {
  heldTotal: string;
  remittedTotal: string;
  items: CustodyItem[];
}

// EP-SP-042 (SP-05, S15) — Custody Funds ONLY (D-14 rule f); never blended
// with the debt figures the dashboard/statement screens show.
export default function CustodyPage() {
  return (
    <Suspense fallback={null}>
      <CustodyPageInner />
    </Suspense>
  );
}

function CustodyPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<CustodyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    authedFetch<CustodyResponse>("/api/v1/supplier/custody")
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }, [locale, router]);


  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1>{t(locale, "custodyTitle")}</h1>
      {error && <p role="alert">{error}</p>}

      {data && (
        <>
          <p className="ps-ltr">{t(locale, "custodyHeld")} {data.heldTotal}</p>
          <p className="ps-ltr">{t(locale, "custodyRemitted")} {data.remittedTotal}</p>

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
            <thead>
              <tr>
                <th>{t(locale, "amountLabel")}</th>
                <th>{t(locale, "statusLabel")}</th>
                <th>{t(locale, "collectedAtLabel")}</th>
                <th>{t(locale, "remittedAtLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.custodyRef}>
                  <td className="ps-ltr">{c.amount}</td>
                  <td>{c.status === "held" ? t(locale, "statusHeld") : t(locale, "statusRemitted")}</td>
                  <td>{new Date(c.collectedAt).toLocaleDateString()}</td>
                  <td>{c.remittedAt ? new Date(c.remittedAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
