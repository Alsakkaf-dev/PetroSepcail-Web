"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { LoginForm } from "../../components/LoginForm";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, otherLocale, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

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

// SF-10 (S09) — FR-SF10-001/003/004/006. Address book (FR-SF10-002) already
// has its own real endpoints (EP-PC-013..015) but no dedicated page yet —
// out of this file's scope, linked to below as a follow-on.
// useLocale() (useSearchParams) requires a Suspense boundary in the Next.js
// App Router static-export path, or `next build` fails at prerender.
export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountPageInner />
    </Suspense>
  );
}

function AccountPageInner() {
  const locale = useLocale();
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
    <main dir={dirFor(locale)} style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>{t(locale, "myAccount")}</h1>
        <Link href={`/account?lang=${otherLocale(locale)}`}>{t(locale, "switchLang")}</Link>
      </header>

      {!loggedIn && <LoginForm locale={locale} promptKey="loginToViewAccount" onLoggedIn={() => setLoggedIn(true)} />}
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {loggedIn && me && (
        <>
          <form onSubmit={saveProfile} style={{ display: "grid", gap: 8, marginBottom: 24 }}>
            <h2 style={{ fontSize: 16 }}>{t(locale, "profile")}</h2>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t(locale, "fullNamePlaceholder")} />
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }} className="ps-ltr">
              {me.email}
            </p>
            <button type="submit">{t(locale, "save")}</button>
            {saved && <p style={{ color: "#1a7f4e" }}>{t(locale, "savedConfirmation")}</p>}
          </form>

          {overview && (
            <section style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16 }}>{t(locale, "overview")}</h2>
              <p>
                {t(locale, "savedAddressesCount")} {overview.addressCount}
              </p>
              <p>
                {t(locale, "openReturnsCount")} {overview.openReturns}
              </p>
              <Link href={`/orders?lang=${locale}`}>{t(locale, "viewAllOrders")}</Link>
            </section>
          )}

          {loyalty && (
            <section style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16 }}>{t(locale, "loyaltyPoints")}</h2>
              <p>
                {t(locale, "balanceLabel")} {loyalty.balance} {t(locale, "pointsUnit")} ({t(locale, "everyLabel")}{" "}
                {loyalty.redeemRate.points} {t(locale, "pointsUnit")} = {loyalty.redeemRate.sar} {t(locale, "sar")})
              </p>
            </section>
          )}

          {consents && (
            <section style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16 }}>{t(locale, "marketingConsents")}</h2>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={marketing?.granted ?? false}
                  onChange={(e) => toggleMarketing(e.target.checked)}
                />
                {t(locale, "marketingOptIn")}
              </label>
            </section>
          )}
        </>
      )}
    </main>
  );
}
