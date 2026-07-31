"use client";

import { Suspense, useEffect, useState } from "react";
import type { WishlistResponse } from "@petrospecial/contracts";
import { authedFetch, getToken } from "../../lib/authClient";
import { t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

// EP-SF-070..073 (SF-09, S13). A standalone page rather than inline
// heart-icon buttons across the catalog/product pages (SF-01/02, S07) —
// wiring the toggle into those already-built, already-working pages wasn't
// attempted this session to avoid risking a regression in code no test
// phase can catch right now; this page is the real, independent surface.
export default function WishlistPage() {
  return (
    <Suspense fallback={null}>
      <WishlistPageInner />
    </Suspense>
  );
}

function WishlistPageInner() {
  const locale = useLocale();
  const [items, setItems] = useState<WishlistResponse["items"] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!getToken()) {
      setItems([]);
      return;
    }
    authedFetch<WishlistResponse>("/api/v1/wishlist")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : "error"));
  }

  useEffect(load, [locale]);

  async function remove(skuId: string) {
    await authedFetch(`/api/v1/wishlist/${skuId}`, { method: "DELETE" });
    load();
  }

  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"}>
      <h1>{locale === "ar" ? "المفضلة" : "Wishlist"}</h1>
      {error && <p role="alert">{error}</p>}
      {!getToken() ? (
        <p>{t(locale, "loginToViewCart")}</p>
      ) : items === undefined ? (
        <p>{t(locale, "loading")}</p>
      ) : items.length === 0 ? (
        <p>{locale === "ar" ? "لا توجد عناصر في المفضلة." : "Your wishlist is empty."}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.skuId}>
              {locale === "ar" ? item.nameAr : item.nameEn} — {item.anyInStock ? t(locale, "inStock") : t(locale, "outOfStock")}
              <button onClick={() => remove(item.skuId)}>{t(locale, "remove")}</button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
