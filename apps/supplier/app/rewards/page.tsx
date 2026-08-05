"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface RewardItem {
  kind: "early_pay" | "volume";
  valueSar: string;
  sourceRef: string | null;
  createdAt: string;
}

// EP-LE-030 (LE-05/06, S20) — rewards land on the debt side as a credit
// note (SP-06 applies it); this is a read-only history, never blended with
// custody (D-14 rule f).
export default function RewardsPage() {
  return (
    <Suspense fallback={null}>
      <RewardsPageInner />
    </Suspense>
  );
}

function RewardsPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<RewardItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    authedFetch<{ items: RewardItem[] }>("/api/v1/supplier/rewards")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }, [locale, router]);


  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1>{t(locale, "rewardsTitle")}</h1>
      {error && <p role="alert">{error}</p>}
      {items && items.length === 0 && <p>{t(locale, "noRewards")}</p>}
      {items && items.length > 0 && (
        <ul>
          {items.map((r, i) => (
            <li key={i}>
              {t(locale, r.kind === "early_pay" ? "earlyPay" : "volume")} — {t(locale, "valueLabel")}{" "}
              <span className="ps-ltr">{r.valueSar}</span> ({new Date(r.createdAt).toLocaleDateString()})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
