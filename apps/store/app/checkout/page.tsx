"use client";

import type { AddressRow, CheckoutQuoteResponse } from "@petrospecial/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authedFetch } from "../../lib/authClient";

const SLOT_LABELS: Record<string, string> = {
  same_day: "اليوم",
  next_am: "غدًا صباحًا (9–13)",
  next_pm: "غدًا مساءً (14–20)"
};

export default function CheckoutPage() {
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

  useEffect(() => {
    authedFetch<{ items: AddressRow[] }>("/api/v1/me/addresses")
      .then((res) => {
        setAddresses(res.items);
        if (res.items[0]) setAddressId(res.items[0].id);
        else setShowNewAddress(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed"));
  }, []);

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
        body: JSON.stringify({ cartId: cart.cartId, addressId, slot, paymentMethod })
      });
      router.push(`/orders/${res.orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <main dir="rtl" style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>إتمام الشراء</h1>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      <section style={{ marginBottom: 24 }}>
        <h2>العنوان</h2>
        {addresses.map((a) => (
          <label key={a.id} style={{ display: "block" }}>
            <input type="radio" name="address" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
            {a.recipientName} — {a.line1}
          </label>
        ))}
        <button type="button" onClick={() => setShowNewAddress((v) => !v)}>
          + عنوان جديد
        </button>
        {showNewAddress && (
          <form onSubmit={addAddress} style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <input
              placeholder="الاسم"
              value={newAddress.recipientName}
              onChange={(e) => setNewAddress({ ...newAddress, recipientName: e.target.value })}
            />
            <input
              placeholder="الجوال"
              value={newAddress.phone}
              onChange={(e) => setNewAddress({ ...newAddress, phone: e.target.value })}
            />
            <input
              placeholder="العنوان"
              value={newAddress.line1}
              onChange={(e) => setNewAddress({ ...newAddress, line1: e.target.value })}
            />
            <input
              placeholder="خط العرض (اختياري)"
              value={newAddress.lat}
              onChange={(e) => setNewAddress({ ...newAddress, lat: e.target.value })}
            />
            <input
              placeholder="خط الطول (اختياري)"
              value={newAddress.lng}
              onChange={(e) => setNewAddress({ ...newAddress, lng: e.target.value })}
            />
            <button type="submit">حفظ العنوان</button>
          </form>
        )}
      </section>

      {addressId && (
        <section style={{ marginBottom: 24 }}>
          <h2>التوصيل</h2>
          <button type="button" onClick={getQuote}>
            احسب رسوم التوصيل
          </button>
          {quote && (
            <div>
              <p>
                رسوم التوصيل: <span className="ps-ltr">{quote.freeDelivery ? "0.00 (مجاني)" : `${quote.deliveryFee} SAR`}</span>
              </p>
              {quote.slots.map((s) => (
                <label key={s.code} style={{ display: "block" }}>
                  <input type="radio" name="slot" checked={slot === s.code} onChange={() => setSlot(s.code)} />
                  {SLOT_LABELS[s.code] ?? s.code}
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      {quote && (
        <section style={{ marginBottom: 24 }}>
          <h2>طريقة الدفع</h2>
          <label style={{ display: "block" }}>
            <input type="radio" checked={paymentMethod === "cod"} onChange={() => setPaymentMethod("cod")} />
            الدفع عند الاستلام
          </label>
          <label style={{ display: "block" }}>
            <input type="radio" checked={paymentMethod === "bank_transfer"} onChange={() => setPaymentMethod("bank_transfer")} />
            تحويل بنكي
          </label>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>الدفع بالبطاقة قريبًا</p>

          <button
            type="button"
            disabled={placing || !slot}
            onClick={placeOrder}
            style={{ padding: "10px 24px", borderRadius: 8, background: "var(--gold)", border: "none", fontWeight: 700 }}
          >
            {placing ? "جارٍ التأكيد..." : "تأكيد الطلب"}
          </button>
        </section>
      )}
    </main>
  );
}
