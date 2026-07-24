"use client";

import type { CartResponse } from "@petrospecial/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LoginForm } from "../../components/LoginForm";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, otherLocale, t, useLocale } from "../../lib/locale";

export default function CartPage() {
  const locale = useLocale();
  const [loggedIn, setLoggedIn] = useState(false);
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

          <div style={{ marginTop: 24, padding: 16, background: "var(--bg-warm)", borderRadius: 8 }}>
            <p>
              {t(locale, "subtotal")} <span className="ps-ltr">{cart.totals.subtotal} {t(locale, "sar")}</span>
            </p>
            <p>
              {t(locale, "vat")} <span className="ps-ltr">{cart.totals.vat} {t(locale, "sar")}</span>
            </p>
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
