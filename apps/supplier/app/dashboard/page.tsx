"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SupplierNav } from "../../components/Nav";
import { authedFetch, clearToken, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface Aging {
  b0_30: string;
  b31_60: string;
  b61_90: string;
  b90plus: string;
}
interface DashboardResponse {
  debt: { exposure: string; creditLimit: string; headroom: string; aging: Aging; openInvoices: number };
  custodyCash: { heldTotal: string; remittedTotal: string };
  goodsCustody: { count: number };
}

// EP-SP-052 · GET /supplier/dashboard (SP-06, S16) — the D-14 rule-f
// centerpiece: three separate panels that never sum into one balance.
export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    authedFetch<DashboardResponse>("/api/v1/supplier/dashboard")
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }, [locale, router]);

  function signOut() {
    clearToken();
    router.push(`/login?lang=${locale}`);
  }

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <SupplierNav locale={locale} onSignOut={signOut} />
      <h1>{t(locale, "dashboardTitle")}</h1>
      {error && <p role="alert">{error}</p>}
      {data === undefined && <p>{t(locale, "loading")}</p>}

      {data && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <section style={{ flex: "1 1 260px", border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
            <h2 style={{ fontSize: 16 }}>{t(locale, "debtPanel")}</h2>
            <p className="ps-ltr">{t(locale, "exposure")} {data.debt.exposure}</p>
            <p className="ps-ltr">{t(locale, "creditLimit")} {data.debt.creditLimit}</p>
            <p className="ps-ltr" style={{ fontWeight: 700 }}>{t(locale, "headroom")} {data.debt.headroom}</p>
            <p>{t(locale, "openInvoices")}: {data.debt.openInvoices}</p>
          </section>

          <section style={{ flex: "1 1 260px", border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
            <h2 style={{ fontSize: 16 }}>{t(locale, "custodyPanel")}</h2>
            <p className="ps-ltr">{t(locale, "custodyHeld")} {data.custodyCash.heldTotal}</p>
            <p className="ps-ltr">{t(locale, "custodyRemitted")} {data.custodyCash.remittedTotal}</p>
          </section>

          <section style={{ flex: "1 1 260px", border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
            <h2 style={{ fontSize: 16 }}>{t(locale, "goodsPanel")}</h2>
            <p>{t(locale, "goodsCustodyCount")}: {data.goodsCustody.count}</p>
          </section>
        </div>
      )}
    </main>
  );
}
