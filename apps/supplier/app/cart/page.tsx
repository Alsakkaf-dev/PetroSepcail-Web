"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface CartLine {
  packSizeId: string;
  skuSlug: string;
  nameAr: string;
  nameEn: string;
  qty: number;
  tierUnitPrice: string;
}
interface CartResponse {
  lines: CartLine[];
  subtotal: string;
  vatAmount: string;
  total: string;
}
interface AddressItem {
  id: string;
  recipientName: string;
  line1: string;
}

// SCR-SP01-002 — cart and checkout are one screen per the UI spec (EP-SP-002
// cart mutation + EP-SP-003 order placement, both SP-01/02, S14).
export default function CartPage() {
  return (
    <Suspense fallback={null}>
      <CartPageInner />
    </Suspense>
  );
}

function CartPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [addresses, setAddresses] = useState<AddressItem[]>([]);
  const [addressId, setAddressId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"credit_terms" | "bank_transfer">("credit_terms");
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  function refresh() {
    authedFetch<CartResponse>("/api/v1/supplier/cart")
      .then(setCart)
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    refresh();
    authedFetch<{ items: AddressItem[] }>("/api/v1/me/addresses")
      .then((res) => {
        setAddresses(res.items);
        if (res.items[0]) setAddressId(res.items[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, router]);

  async function updateQty(packSizeId: string, qty: number) {
    await authedFetch("/api/v1/supplier/cart", { method: "PATCH", body: JSON.stringify({ packSizeId, qty }) });
    refresh();
  }

  async function removeLine(packSizeId: string) {
    await authedFetch(`/api/v1/supplier/cart?packSizeId=${packSizeId}`, { method: "DELETE" });
    refresh();
  }

  async function placeOrder() {
    if (!cart || !addressId) return;
    setPlacing(true);
    setError(null);
    try {
      const res = await authedFetch<{ orderId: string }>("/api/v1/supplier/orders", {
        method: "POST",
        headers: { "idempotency-key": `supplier-${addressId}-${Date.now()}` },
        body: JSON.stringify({
          lines: cart.lines.map((l) => ({ packSizeId: l.packSizeId, qty: l.qty })),
          paymentMethod,
          addressId
        })
      });
      router.push(`/orders/${res.orderId}?lang=${locale}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setPlacing(false);
    }
  }


  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1>{t(locale, "cartTitle")}</h1>
      {error && <p role="alert">{error}</p>}

      {cart && cart.lines.length === 0 && <p>{t(locale, "cartEmpty")}</p>}

      {cart && cart.lines.length > 0 && (
        <>
          <div style={{ display: "grid", gap: 12 }}>
            {cart.lines.map((line) => (
              <div key={line.packSizeId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
                <p style={{ margin: 0, fontWeight: 700 }}>{locale === "ar" ? line.nameAr : line.nameEn}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={line.qty}
                    onChange={(e) => updateQty(line.packSizeId, Number(e.target.value))}
                    style={{ width: 60 }}
                  />
                  <span className="ps-ltr">{line.tierUnitPrice}</span>
                  <button type="button" onClick={() => removeLine(line.packSizeId)}>
                    {t(locale, "remove")}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16 }}>
            <p className="ps-ltr">{t(locale, "subtotal")} {cart.subtotal}</p>
            <p className="ps-ltr">{t(locale, "vat")} {cart.vatAmount}</p>
            <p className="ps-ltr" style={{ fontWeight: 700 }}>{t(locale, "total")} {cart.total}</p>
          </div>

          <section style={{ marginTop: 16 }}>
            <label>
              {t(locale, "addressLabel")}
              <select value={addressId} onChange={(e) => setAddressId(e.target.value)} style={{ display: "block", width: "100%", padding: 8 }}>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.recipientName} — {a.line1}
                  </option>
                ))}
              </select>
            </label>

            <fieldset style={{ marginTop: 12 }}>
              <legend>{t(locale, "paymentMethodLabel")}</legend>
              <label style={{ display: "block" }}>
                <input type="radio" checked={paymentMethod === "credit_terms"} onChange={() => setPaymentMethod("credit_terms")} />
                {t(locale, "creditTerms")}
              </label>
              <label style={{ display: "block" }}>
                <input type="radio" checked={paymentMethod === "bank_transfer"} onChange={() => setPaymentMethod("bank_transfer")} />
                {t(locale, "bankTransfer")}
              </label>
            </fieldset>

            <button type="button" disabled={placing || !addressId} onClick={placeOrder} style={{ marginTop: 12, padding: "10px 24px" }}>
              {placing ? t(locale, "placingOrder") : t(locale, "placeOrder")}
            </button>
          </section>
        </>
      )}
    </main>
  );
}
