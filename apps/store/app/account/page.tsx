"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authedFetch, getToken, login } from "../../lib/authClient";

interface MeResponse {
  fullName: string;
  email: string;
  phone: string;
  locale: "ar" | "en";
}
interface AccountOverview {
  recentOrders: Array<{ orderId: string; status: string; total: string; placedAt: string }>;
  pointsBalance: number;
  addressCount: number;
  openReturns: number;
}
interface LoyaltyOverview {
  balance: number;
  redeemRate: { points: number; sar: number };
}
interface ConsentItem {
  kind: "service_terms" | "privacy" | "marketing";
  granted: boolean;
}

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
      <p>سجّل الدخول لعرض حسابك</p>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="البريد الإلكتروني" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور" />
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      <button type="submit">دخول</button>
    </form>
  );
}

// SF-10 (S09) — FR-SF10-001/003/004/006. Address book (FR-SF10-002) already
// has its own real endpoints (EP-PC-013..015) but no dedicated page yet —
// out of this file's scope, linked to below as a follow-on.
export default function AccountPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyOverview | null>(null);
  const [consents, setConsents] = useState<ConsentItem[] | null>(null);
  const [fullName, setFullName] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(!!getToken());
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    Promise.all([
      authedFetch<MeResponse>("/api/v1/me"),
      authedFetch<AccountOverview>("/api/v1/account/overview"),
      authedFetch<LoyaltyOverview>("/api/v1/account/loyalty"),
      authedFetch<{ items: ConsentItem[] }>("/api/v1/account/consents")
    ])
      .then(([meRes, overviewRes, loyaltyRes, consentsRes]) => {
        setMe(meRes);
        setFullName(meRes.fullName);
        setOverview(overviewRes);
        setLoyalty(loyaltyRes);
        setConsents(consentsRes.items);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed"));
  }, [loggedIn]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    try {
      const updated = await authedFetch<MeResponse>("/api/v1/me", { method: "PATCH", body: JSON.stringify({ fullName }) });
      setMe(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function toggleMarketing(granted: boolean) {
    await authedFetch("/api/v1/account/consents", { method: "PATCH", body: JSON.stringify({ marketing: granted }) });
    const res = await authedFetch<{ items: ConsentItem[] }>("/api/v1/account/consents");
    setConsents(res.items);
  }

  const marketing = consents?.find((c) => c.kind === "marketing");

  return (
    <main dir="rtl" style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>حسابي</h1>

      {!loggedIn && <LoginForm onLoggedIn={() => setLoggedIn(true)} />}
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {loggedIn && me && (
        <>
          <form onSubmit={saveProfile} style={{ display: "grid", gap: 8, marginBottom: 24 }}>
            <h2 style={{ fontSize: 16 }}>الملف الشخصي</h2>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="الاسم الكامل" />
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }} className="ps-ltr">
              {me.email}
            </p>
            <button type="submit">حفظ</button>
            {saved && <p style={{ color: "#1a7f4e" }}>تم الحفظ.</p>}
          </form>

          {overview && (
            <section style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16 }}>نظرة عامة</h2>
              <p>عدد العناوين المحفوظة: {overview.addressCount}</p>
              <p>الطلبات المرتجعة المفتوحة: {overview.openReturns}</p>
              <Link href="/orders">عرض كل الطلبات</Link>
            </section>
          )}

          {loyalty && (
            <section style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16 }}>نقاط الولاء</h2>
              <p>
                الرصيد: {loyalty.balance} نقطة (كل {loyalty.redeemRate.points} نقطة = {loyalty.redeemRate.sar} ر.س)
              </p>
            </section>
          )}

          {consents && (
            <section style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16 }}>التسويق والاتصالات</h2>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={marketing?.granted ?? false}
                  onChange={(e) => toggleMarketing(e.target.checked)}
                />
                أوافق على استقبال العروض التسويقية
              </label>
            </section>
          )}
        </>
      )}
    </main>
  );
}
