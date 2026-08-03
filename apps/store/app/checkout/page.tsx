"use client";

import type { AddressRow, CartResponse, CheckoutQuoteResponse } from "@petrospecial/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { authedFetch } from "../../lib/authClient";
import { dirFor, otherLocale, slotLabel, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface PointsBalanceResponse {
  balance: number;
}
interface RedemptionQuoteResponse {
  allowedPoints: number;
  discountSar: string;
}

// useLocale() (useSearchParams) requires a Suspense boundary in the Next.js
// App Router static-export path, or `next build` fails at prerender.
export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutPageInner />
    </Suspense>
  );
}

function CheckoutPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [addressId, setAddressId] = useState<string>("");
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({ recipientName: "", phone: "", line1: "", lat: "", lng: "" });
  const [quote, setQuote] = useState<CheckoutQuoteResponse | null>(null);
  const [slot, setSlot] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "bank_transfer">("cod");
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [cartTotal, setCartTotal] = useState<number | null>(null);
  const [pointsBalance, setPointsBalance] = useState(0);
  const [pointsToRedeem, setPointsToRedeem] = useState("");
  const [redemption, setRedemption] = useState<RedemptionQuoteResponse | null>(null);
  const [redeemBusy, setRedeemBusy] = useState(false);

  useEffect(() => {
    authedFetch<{ items: AddressRow[] }>("/api/v1/me/addresses")
      .then((res) => {
        setAddresses(res.items);
        if (res.items[0]) setAddressId(res.items[0].id);
        else setShowNewAddress(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed"));
    authedFetch<CartResponse>("/api/v1/cart")
      .then((res) => setCartTotal(Number(res.totals.total)))
      .catch(() => {});
    authedFetch<PointsBalanceResponse>("/api/v1/loyalty/points/balance")
      .then((res) => setPointsBalance(res.balance))
      .catch(() => {});
  }, []);

  // EP-X-003 (LE-07, S19) — a live preview only; the server re-caps via
  // loyalty.quote_redemption at order placement too, never trusting the
  // client's own number (NFR-LE-003).
  async function previewRedemption() {
    const requested = Number(pointsToRedeem);
    if (!requested || requested <= 0 || cartTotal === null) return;
    setRedeemBusy(true);
    try {
      const res = await authedFetch<RedemptionQuoteResponse>("/api/v1/loyalty/redemption/quote", {
        method: "POST",
        body: JSON.stringify({ pointsRequested: requested, orderTotal: cartTotal })
      });
      setRedemption(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setRedeemBusy(false);
    }
  }

  async function addAddress(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await authedFetch<AddressRow>("/api/v1/me/addresses", {
        method: "POST",
        body: JSON.stringify({
          recipientName: newAddress.recipientName,
          phone: newAddress.phone,
          line1: newAddress.line1,
          city: "Jeddah",
          lat: newAddress.lat ? Number(newAddress.lat) : null,
          lng: newAddress.lng ? Number(newAddress.lng) : null,
          isDefault: true
        })
      });
      setAddresses((prev) => [...prev, created]);
      setAddressId(created.id);
      setShowNewAddress(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function getQuote() {
    setError(null);
    setQuote(null);
    try {
      const res = await authedFetch<CheckoutQuoteResponse>("/api/v1/checkout/quote", {
        method: "POST",
        body: JSON.stringify({ addressId })
      });
      setQuote(res);
      if (res.slots[0]) setSlot(res.slots[0].code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function placeOrder() {
    setPlacing(true);
    setError(null);
    try {
      const cart = await authedFetch<{ cartId: string }>("/api/v1/cart");
      const res = await authedFetch<{ orderId: string }>("/api/v1/orders", {
        method: "POST",
        headers: { "idempotency-key": `store-${cart.cartId}-${Date.now()}` },
        body: JSON.stringify({
          cartId: cart.cartId,
          addressId,
          slot,
          paymentMethod,
          pointsToRedeem: redemption ? redemption.allowedPoints : undefined
        })
      });
      router.push(`/orders/${res.orderId}?lang=${locale}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>{t(locale, "checkoutTitle")}</h1>
        <Link href={`/checkout?lang=${otherLocale(locale)}`}>{t(locale, "switchLang")}</Link>
      </header>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      <section style={{ marginBottom: 24 }}>
        <h2>{t(locale, "addressLabel")}</h2>
        {addresses.map((a) => (
          <label key={a.id} style={{ display: "block" }}>
            <input type="radio" name="address" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
            {a.recipientName} — {a.line1}
          </label>
        ))}
        <button type="button" onClick={() => setShowNewAddress((v) => !v)}>
          {t(locale, "addNewAddress")}
        </button>
        {showNewAddress && (
          <form onSubmit={addAddress} style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <input
              placeholder={t(locale, "recipientNamePlaceholder")}
              value={newAddress.recipientName}
              onChange={(e) => setNewAddress({ ...newAddress, recipientName: e.target.value })}
            />
            <input
              placeholder={t(locale, "phonePlaceholder")}
              value={newAddress.phone}
              onChange={(e) => setNewAddress({ ...newAddress, phone: e.target.value })}
            />
            <input
              placeholder={t(locale, "addressLine1Placeholder")}
              value={newAddress.line1}
              onChange={(e) => setNewAddress({ ...newAddress, line1: e.target.value })}
            />
            <input
              placeholder={t(locale, "latPlaceholder")}
              value={newAddress.lat}
              onChange={(e) => setNewAddress({ ...newAddress, lat: e.target.value })}
            />
            <input
              placeholder={t(locale, "lngPlaceholder")}
              value={newAddress.lng}
              onChange={(e) => setNewAddress({ ...newAddress, lng: e.target.value })}
            />
            <button type="submit">{t(locale, "saveAddress")}</button>
          </form>
        )}
      </section>

      {addressId && (
        <section style={{ marginBottom: 24 }}>
          <h2>{t(locale, "deliveryLabel")}</h2>
          <button type="button" onClick={getQuote}>
            {t(locale, "calculateDeliveryFee")}
          </button>
          {quote && (
            <div>
              <p>
                {t(locale, "deliveryFee")}{" "}
                <span className="ps-ltr">
                  {quote.freeDelivery ? `0.00 ${t(locale, "free")}` : `${quote.deliveryFee} ${t(locale, "sar")}`}
                </span>
              </p>
              {quote.slots.map((s) => (
                <label key={s.code} style={{ display: "block" }}>
                  <input type="radio" name="slot" checked={slot === s.code} onChange={() => setSlot(s.code)} />
                  {slotLabel(locale, s.code)}
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      {quote && pointsBalance > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2>{t(locale, "redeemPointsLabel")}</h2>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            {t(locale, "pointsAvailableLabel")} <span className="ps-ltr">{pointsBalance} {t(locale, "pointsUnitShort")}</span>
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              min={0}
              max={pointsBalance}
              value={pointsToRedeem}
              onChange={(e) => {
                setPointsToRedeem(e.target.value);
                setRedemption(null);
              }}
              style={{ width: 100 }}
              className="ps-ltr"
            />
            <button type="button" disabled={redeemBusy} onClick={previewRedemption}>
              {t(locale, "applyPointsAction")}
            </button>
          </div>
          {redemption && (
            <p>
              {t(locale, "pointsDiscountLabel")}{" "}
              <span className="ps-ltr">
                {redemption.allowedPoints} {t(locale, "pointsUnitShort")} = -{redemption.discountSar} {t(locale, "sar")}
              </span>
            </p>
          )}
        </section>
      )}

      {quote && (
        <section style={{ marginBottom: 24 }}>
          <h2>{t(locale, "paymentMethodLabel")}</h2>
          <label style={{ display: "block" }}>
            <input type="radio" checked={paymentMethod === "cod"} onChange={() => setPaymentMethod("cod")} />
            {t(locale, "cod")}
          </label>
          <label style={{ display: "block" }}>
            <input
              type="radio"
              checked={paymentMethod === "bank_transfer"}
              onChange={() => setPaymentMethod("bank_transfer")}
            />
            {t(locale, "bankTransfer")}
          </label>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>{t(locale, "cardComingSoon")}</p>

          <button
            type="button"
            disabled={placing || !slot}
            onClick={placeOrder}
            style={{ padding: "10px 24px", borderRadius: 8, background: "var(--gold)", border: "none", fontWeight: 700 }}
          >
            {placing ? t(locale, "placingOrder") : t(locale, "confirmOrder")}
          </button>
        </section>
      )}
    </main>
  );
}
