"use client";

import type { CartResponse } from "@petrospecial/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { authedFetch, getToken, login } from "../../lib/authClient";

function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("customer.seed@petrospecial.internal");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, display: "grid", gap: 12 }} dir="rtl">
      <p>سجّل الدخول لعرض سلتك</p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="البريد الإلكتروني"
        style={{ padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="كلمة المرور"
        style={{ padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
      />
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      <button type="submit" style={{ padding: "8px 16px", borderRadius: 6, background: "var(--gold)", border: "none" }}>
        دخول
      </button>
    </form>
  );
}

export default function CartPage() {
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
    <main dir="rtl" style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>سلة المشتريات</h1>

      {!loggedIn && <LoginForm onLoggedIn={() => setLoggedIn(true)} />}
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {loggedIn && cart && cart.lines.length === 0 && (
        <div>
          <p>سلتك فارغة.</p>
          <Link href="/catalog">تصفح المنتجات</Link>
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
                  <p style={{ margin: 0, fontWeight: 700 }}>{line.nameAr}</p>
                  {!line.inStock && <p style={{ margin: 0, color: "#b91c1c", fontSize: 12 }}>غير متوفر حاليًا</p>}
                  {line.priceUpdated && <p style={{ margin: 0, color: "var(--flame)", fontSize: 12 }}>تم تحديث السعر</p>}
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
                  <span className="ps-ltr">{line.unitPrice} SAR</span>
                  <button type="button" onClick={() => removeLine(line.lineId)}>
                    إزالة
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, padding: 16, background: "var(--bg-warm)", borderRadius: 8 }}>
            <p>
              المجموع الفرعي: <span className="ps-ltr">{cart.totals.subtotal} SAR</span>
            </p>
            <p>
              الضريبة: <span className="ps-ltr">{cart.totals.vat} SAR</span>
            </p>
            <p style={{ fontWeight: 700 }}>
              الإجمالي: <span className="ps-ltr">{cart.totals.total} SAR</span>
            </p>
            {cart.freeDeliveryRemaining && (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>
                أضف <span className="ps-ltr">{cart.freeDeliveryRemaining} SAR</span> أخرى للحصول على توصيل مجاني
              </p>
            )}
            <Link href="/checkout">
              <button
                type="button"
                style={{ padding: "10px 24px", borderRadius: 8, background: "var(--gold)", border: "none", fontWeight: 700 }}
              >
                إتمام الشراء
              </button>
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
