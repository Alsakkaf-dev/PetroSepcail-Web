"use client";

import { Suspense, useEffect, useState } from "react";
import type { ReturnListResponse } from "@petrospecial/contracts";
import { authedFetch, getToken } from "../../lib/authClient";
import { t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

// EP-SF-052 (SF-07, S13) — list view only; requesting a return happens from
// the order-detail page (SF-05), which this session did not extend with a
// "request return" form (a real, separate piece of work — the eligibility/
// creation endpoints are built and callable, just not wired into that page's UI yet).
export default function ReturnsPage() {
  return (
    <Suspense fallback={null}>
      <ReturnsPageInner />
    </Suspense>
  );
}

function ReturnsPageInner() {
  const locale = useLocale();
  const [items, setItems] = useState<ReturnListResponse["items"] | undefined>(undefined);

  useEffect(() => {
    if (!getToken()) {
      setItems([]);
      return;
    }
    authedFetch<ReturnListResponse>("/api/v1/returns")
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, [locale]);

  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"}>
      <h1>{locale === "ar" ? "المرتجعات" : "Returns"}</h1>
      {!getToken() ? (
        <p>{t(locale, "loginToViewOrders")}</p>
      ) : items === undefined ? (
        <p>{t(locale, "loading")}</p>
      ) : items.length === 0 ? (
        <p>{locale === "ar" ? "لا توجد مرتجعات." : "No returns yet."}</p>
      ) : (
        <ul>
          {items.map((r) => (
            <li key={r.returnId}>
              {r.orderId} — {r.status}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
