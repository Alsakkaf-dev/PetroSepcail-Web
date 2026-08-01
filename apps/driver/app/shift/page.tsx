"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ShiftResponse } from "@petrospecial/contracts";
import { authedFetch } from "../../lib/authClient";
import { t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

// EP-DL-001/002 (DL-07, S11) — shows the driver's current shift, or a real
// load-out picker if none is open. Real gap closed this pass: this page
// previously had no way to actually START a shift at all (just a "no shift"
// message) even though the API (POST /driver/shifts/start) always accepted
// a full `load: [{packSizeId, qty}]` array — the form simply didn't exist.
export default function ShiftPage() {
  return (
    <Suspense fallback={null}>
      <ShiftPageInner />
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
interface LoadLine {
  packSizeId: string;
  label: string;
  qty: number;
}

function LoadOutForm({ locale, onStarted }: { locale: "ar" | "en"; onStarted: (shift: ShiftResponse) => void }) {
  const [vanId, setVanId] = useState("");
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [packSizes, setPackSizes] = useState<PackSize[]>([]);
  const [selectedPackSize, setSelectedPackSize] = useState("");
  const [qty, setQty] = useState(1);
  const [lines, setLines] = useState<LoadLine[]>([]);
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
    if (!selectedPackSize || qty < 1) return;
    const label = packSizes.find((p) => p.packSizeId === selectedPackSize)?.sizeLabel ?? selectedPackSize;
    setLines((prev) => {
      const existing = prev.find((l) => l.packSizeId === selectedPackSize);
      if (existing) return prev.map((l) => (l.packSizeId === selectedPackSize ? { ...l, qty: l.qty + qty } : l));
      return [...prev, { packSizeId: selectedPackSize, label, qty }];
    });
  }

  async function startShift() {
    if (!vanId || lines.length === 0) {
      setError("Van ID and at least one load line are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const shift = await authedFetch<{ shiftId: string; openingStock: LoadLine[] }>("/api/v1/driver/shifts/start", {
        method: "POST",
        body: JSON.stringify({ vanId, load: lines.map((l) => ({ packSizeId: l.packSizeId, qty: l.qty })) })
      });
      onStarted({
        shiftId: shift.shiftId,
        vanId,
        status: "open",
        available: true,
        vanStock: lines.map((l) => ({ packSizeId: l.packSizeId, qty: l.qty })),
        custodyHeld: "0.00"
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to start shift");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p>{t(locale, "noShift")}</p>
      <label>
        Van ID (UUID)
        <input value={vanId} onChange={(e) => setVanId(e.target.value)} style={{ display: "block", width: "100%", padding: 8 }} />
      </label>

      <fieldset style={{ marginTop: 12 }}>
        <legend>Add load line</legend>
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
        <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: 60 }} />
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

      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={startShift}>
        {busy ? "Starting…" : "Start shift"}
      </button>
    </div>
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
        <LoadOutForm locale={locale} onStarted={setShift} />
      )}
    </main>
  );
}
