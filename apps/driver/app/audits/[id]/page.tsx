"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { AuditCountResponse } from "@petrospecial/contracts";
import { authedFetch } from "../../../lib/authClient";
import { t } from "../../../lib/locale";
import { useLocale } from "../../../lib/useLocale";

// EP-DL-071 (DL-06, S12) — the driver counts the van blind (no expected
// quantities shown up front, matching the zero-tolerance point of the
// check: delivery.close_audit computes the expected/counted delta
// server-side and the driver only learns it from the result). Same
// product -> pack-size cascading picker as app/shift/page.tsx's LoadOutForm.
export default function AuditCountPage() {
  return (
    <Suspense fallback={null}>
      <AuditCountPageInner />
    </Suspense>
  );
}

interface ProductCard {
  slug: string;
  nameAr: string;
  nameEn: string;
}
interface PackSize {
  packSizeId: string;
  sizeLabel: string;
}
interface CountLine {
  packSizeId: string;
  label: string;
  qty: number;
}

function AuditCountPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [packSizes, setPackSizes] = useState<PackSize[]>([]);
  const [selectedPackSize, setSelectedPackSize] = useState("");
  const [qty, setQty] = useState(1);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [result, setResult] = useState<AuditCountResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authedFetch<{ items: ProductCard[] }>("/api/v1/catalog/products?limit=100")
      .then((res) => setProducts(res.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedSlug) {
      setPackSizes([]);
      return;
    }
    authedFetch<{ items: PackSize[] }>(`/api/v1/catalog/products/${selectedSlug}/pack-sizes`)
      .then((res) => {
        setPackSizes(res.items);
        setSelectedPackSize(res.items[0]?.packSizeId ?? "");
      })
      .catch(() => setPackSizes([]));
  }, [selectedSlug]);

  function addLine() {
    if (!selectedPackSize || qty < 0) return;
    const label = packSizes.find((p) => p.packSizeId === selectedPackSize)?.sizeLabel ?? selectedPackSize;
    setLines((prev) => {
      const existing = prev.find((l) => l.packSizeId === selectedPackSize);
      if (existing) return prev.map((l) => (l.packSizeId === selectedPackSize ? { ...l, qty } : l));
      return [...prev, { packSizeId: selectedPackSize, label, qty }];
    });
  }

  async function submitCount() {
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch<AuditCountResponse>(`/api/v1/driver/audits/${params.id}/count`, {
        method: "POST",
        body: JSON.stringify({ counted: lines.map((l) => ({ packSizeId: l.packSizeId, qty: l.qty })) })
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <main dir={locale === "ar" ? "rtl" : "ltr"}>
        <h1>{t(locale, "audits")}</h1>
        <p>
          {t(locale, "auditStatus")}: {result.status}
        </p>
        {result.variance.length === 0 ? (
          <p>OK</p>
        ) : (
          <ul>
            {result.variance.map((v) => (
              <li key={v.packSizeId}>
                {v.packSizeId}: expected {v.expected}, counted {v.counted}, delta {v.delta}
              </li>
            ))}
          </ul>
        )}
        <button onClick={() => router.push(`/audits?lang=${locale}`)}>{t(locale, "back")}</button>
      </main>
    );
  }

  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"}>
      <button onClick={() => router.push(`/audits?lang=${locale}`)}>{t(locale, "back")}</button>
      <h1>{t(locale, "countAudit")}</h1>
      {error && <p role="alert">{error}</p>}

      <fieldset>
        <legend>Add counted line</legend>
        <select value={selectedSlug} onChange={(e) => setSelectedSlug(e.target.value)}>
          <option value="">Select product…</option>
          {products.map((p) => (
            <option key={p.slug} value={p.slug}>
              {locale === "ar" ? p.nameAr : p.nameEn}
            </option>
          ))}
        </select>
        <select value={selectedPackSize} onChange={(e) => setSelectedPackSize(e.target.value)} disabled={packSizes.length === 0}>
          {packSizes.map((p) => (
            <option key={p.packSizeId} value={p.packSizeId}>
              {p.sizeLabel}
            </option>
          ))}
        </select>
        <input type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: 60 }} />
        <button type="button" onClick={addLine}>
          Add
        </button>
      </fieldset>

      <ul>
        {lines.map((l) => (
          <li key={l.packSizeId}>
            {l.label} × {l.qty}
          </li>
        ))}
      </ul>

      <button type="button" disabled={busy || lines.length === 0} onClick={submitCount}>
        {t(locale, "submit")}
      </button>
    </main>
  );
}
