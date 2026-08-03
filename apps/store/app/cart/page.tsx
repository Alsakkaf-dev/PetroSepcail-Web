"use client";

import type { ApplyCouponResponse, CartResponse } from "@petrospecial/contracts";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { LoginForm } from "../../components/LoginForm";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, otherLocale, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

// useLocale() (useSearchParams) requires a Suspense boundary in the Next.js
// App Router static-export path, or `next build` fails at prerender.
export default function CartPage() {
  return (
    <Suspense fallback={null}>
      <CartPageInner />
    </Suspense>
  );
}

function CartPageInner() {
  const locale = useLocale();
  const [loggedIn, setLoggedIn] = useState(false);
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(!!getToken());
  }, []);

  async function refresh() {
    try {
      const data = await authedFetch<CartResponse>("/api/v1/cart");
      setCart(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  useEffect(() => {
    if (loggedIn) refresh();
  }, [loggedIn]);

  async function updateQty(lineId: string, qty: number) {
    await authedFetch(`/api/v1/cart/lines/${lineId}`, { method: "PATCH", body: JSON.stringify({ qty }) });
    refresh();
  }

  async function removeLine(lineId: string) {
    await authedFetch(`/api/v1/cart/lines/${lineId}`, { method: "DELETE" });
    refresh();
  }

  // EP-SF-014/015 (LE-02, S19) — a coupon is validated live against the
  // real loyalty engine here; the same code is re-validated server-side
  // again at order placement (routes/checkout.ts), never trusted twice.
  async function applyCoupon() {
    if (!couponInput.trim()) return;
    setCouponBusy(true);
    setCouponMessage(null);
    try {
      const res = await authedFetch<ApplyCouponResponse>("/api/v1/cart/coupon", {
        method: "POST",
        body: JSON.stringify({ code: couponInput.trim() })
      });
      if (!res.valid) setCouponMessage(res.reason);
      refresh();
    } catch (err) {
      setCouponMessage(err instanceof Error ? err.message : "failed");
    } finally {
      setCouponBusy(false);
    }
  }

  async function removeCoupon() {
    setCouponBusy(true);
    try {
      await authedFetch("/api/v1/cart/coupon", { method: "DELETE" });
      setCouponInput("");
      setCouponMessage(null);
      refresh();
    } finally {
      setCouponBusy(false);
    }
  }

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>{t(locale, "cartTitle")}</h1>
        <Link href={`/cart?lang=${otherLocale(locale)}`}>{t(locale, "switchLang")}</Link>
      </header>

      {!loggedIn && <LoginForm locale={locale} promptKey="loginToViewCart" onLoggedIn={() => setLoggedIn(true)} />}
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {loggedIn && cart && cart.lines.length === 0 && (
        <div>
          <p>{t(locale, "cartEmpty")}</p>
          <Link href={`/catalog?lang=${locale}`}>{t(locale, "browseProducts")}</Link>
        </div>
      )}

      {loggedIn && cart && cart.lines.length > 0 && (
        <>
          <div style={{ display: "grid", gap: 12 }}>
            {cart.lines.map((line) => (
              <div
                key={line.lineId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 12,
                  border: "1px solid var(--line)",
                  borderRadius: 8
                }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: 700 }}>{locale === "ar" ? line.nameAr : line.nameEn}</p>
                  {!line.inStock && (
                    <p style={{ margin: 0, color: "#b91c1c", fontSize: 12 }}>{t(locale, "currentlyUnavailable")}</p>
                  )}
                  {line.priceUpdated && (
                    <p style={{ margin: 0, color: "var(--flame)", fontSize: 12 }}>{t(locale, "priceUpdated")}</p>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={line.qty}
                    onChange={(e) => updateQty(line.lineId, Number(e.target.value))}
                    style={{ width: 60 }}
                  />
                  <span className="ps-ltr">
                    {line.unitPrice} {t(locale, "sar")}
                  </span>
                  <button type="button" onClick={() => removeLine(line.lineId)}>
                    {t(locale, "remove")}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ margin: "16px 0" }}>
            {cart.coupon ? (
              <p>
                {t(locale, "couponAppliedPrefix")} <span className="ps-ltr">{cart.coupon.code}</span>{" "}
                <button type="button" disabled={couponBusy} onClick={removeCoupon}>
                  {t(locale, "removeCoupon")}
                </button>
              </p>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  placeholder={t(locale, "couponCodePlaceholder")}
                  className="ps-ltr"
                />
                <button type="button" disabled={couponBusy} onClick={applyCoupon}>
                  {couponBusy ? t(locale, "couponApplying") : t(locale, "applyCoupon")}
                </button>
              </div>
            )}
            {couponMessage && <p style={{ color: "#b91c1c", fontSize: 13 }}>{couponMessage}</p>}
          </div>

          <div style={{ marginTop: 24, padding: 16, background: "var(--bg-warm)", borderRadius: 8 }}>
            <p>
              {t(locale, "subtotal")} <span className="ps-ltr">{cart.totals.subtotal} {t(locale, "sar")}</span>
            </p>
            <p>
              {t(locale, "vat")} <span className="ps-ltr">{cart.totals.vat} {t(locale, "sar")}</span>
            </p>
            {Number(cart.totals.discount) > 0 && (
              <p>
                {t(locale, "discountLabel")} <span className="ps-ltr">-{cart.totals.discount} {t(locale, "sar")}</span>
              </p>
            )}
            <p style={{ fontWeight: 700 }}>
              {t(locale, "total")} <span className="ps-ltr">{cart.totals.total} {t(locale, "sar")}</span>
            </p>
            {cart.freeDeliveryRemaining && (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>
                {t(locale, "freeDeliveryHintPrefix")}{" "}
                <span className="ps-ltr">
                  {cart.freeDeliveryRemaining} {t(locale, "sar")}
                </span>{" "}
                {t(locale, "freeDeliveryHintSuffix")}
              </p>
            )}
            <Link href={`/checkout?lang=${locale}`}>
              <button
                type="button"
                style={{ padding: "10px 24px", borderRadius: 8, background: "var(--gold)", border: "none", fontWeight: 700 }}
              >
                {t(locale, "proceedToCheckout")}
              </button>
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
