"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface CatalogItem {
  packSizeId: string;
  skuSlug: string;
  nameAr: string;
  nameEn: string;
  tierUnitPrice: string;
  inStock: boolean;
}

// EP-SP-001/002 (SP-01, S14) — tier prices only ever reach a supplier
// session; the endpoint itself enforces role=supplier server-side.
export default function CatalogPage() {
  return (
    <Suspense fallback={null}>
      <CatalogPageInner />
    </Suspense>
  );
}

function CatalogPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    authedFetch<{ items: CatalogItem[] }>("/api/v1/supplier/catalog?limit=100")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }, [locale, router]);

  async function addToCart(packSizeId: string) {
    setAdded(null);
    try {
      await authedFetch("/api/v1/supplier/cart", {
        method: "POST",
        body: JSON.stringify({ packSizeId, qty: qty[packSizeId] ?? 1 })
      });
      setAdded(packSizeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    }
  }


  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <h1>{t(locale, "catalogTitle")}</h1>
      {error && <p role="alert">{error}</p>}

      {items === null && <p>{t(locale, "loading")}</p>}

      <div style={{ display: "grid", gap: 12 }}>
        {items?.map((item) => (
          <div key={item.packSizeId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 700 }}>{locale === "ar" ? item.nameAr : item.nameEn}</p>
              <p style={{ margin: 0, fontSize: 12 }}>{item.inStock ? t(locale, "inStock") : t(locale, "outOfStock")}</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="ps-ltr">{item.tierUnitPrice}</span>
              <input
                type="number"
                min={1}
                max={99}
                value={qty[item.packSizeId] ?? 1}
                onChange={(e) => setQty((q) => ({ ...q, [item.packSizeId]: Number(e.target.value) }))}
                style={{ width: 60 }}
              />
              <button type="button" disabled={!item.inStock} onClick={() => addToCart(item.packSizeId)}>
                {t(locale, "addToCart")}
              </button>
              {added === item.packSizeId && <span style={{ color: "#1a7f4e" }}>✓</span>}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
