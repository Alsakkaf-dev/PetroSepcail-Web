"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SupplierNav } from "../../components/Nav";
import { authedFetch, clearToken, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface ProfileResponse {
  businessNameAr: string;
  businessNameEn: string;
  tier: "bronze" | "silver" | "gold";
  creditLimit: string;
  isPickupPoint: boolean;
  geo: { lat: number; lng: number } | null;
  bank: { name: string | null; ibanMasked: string | null };
}

// EP-SP-010/011 (SP-01, S14) — tier/creditLimit/isPickupPoint are
// admin-only (AC-03); this screen only ever submits contact+bank fields,
// enforced structurally server-side too (PATCH rejects those keys 403).
export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfilePageInner />
    </Suspense>
  );
}

function ProfilePageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [businessNameAr, setBusinessNameAr] = useState("");
  const [businessNameEn, setBusinessNameEn] = useState("");
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    authedFetch<ProfileResponse>("/api/v1/supplier/profile")
      .then((res) => {
        setProfile(res);
        setBusinessNameAr(res.businessNameAr);
        setBusinessNameEn(res.businessNameEn);
        setBankName(res.bank.name ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    try {
      await authedFetch("/api/v1/supplier/profile", {
        method: "PATCH",
        body: JSON.stringify({
          contact: { businessNameAr, businessNameEn },
          bank: { name: bankName || undefined, iban: iban || undefined }
        })
      });
      setSaved(true);
      setIban("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    }
  }

  function signOut() {
    clearToken();
    router.push(`/login?lang=${locale}`);
  }

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <SupplierNav locale={locale} onSignOut={signOut} />
      <h1>{t(locale, "profileTitle")}</h1>
      {error && <p role="alert">{error}</p>}

      {profile && (
        <>
          <p>
            {t(locale, "tierLabel")}: {profile.tier} — {t(locale, "headroomLabel")}: <span className="ps-ltr">{profile.creditLimit}</span>
          </p>
          {profile.isPickupPoint && <p>{t(locale, "pickupPointLabel")}</p>}

          <form onSubmit={save} style={{ display: "grid", gap: 12, marginTop: 16 }}>
            <h2 style={{ fontSize: 16 }}>{t(locale, "contactSectionTitle")}</h2>
            <input value={businessNameAr} onChange={(e) => setBusinessNameAr(e.target.value)} placeholder={t(locale, "businessNameArLabel")} />
            <input value={businessNameEn} onChange={(e) => setBusinessNameEn(e.target.value)} placeholder={t(locale, "businessNameEnLabel")} />

            <h2 style={{ fontSize: 16 }}>{t(locale, "bankSectionTitle")}</h2>
            <p className="ps-ltr" style={{ fontSize: 13, color: "#666" }}>{profile.bank.ibanMasked ?? "—"}</p>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder={t(locale, "bankNameLabel")} />
            <input value={iban} onChange={(e) => setIban(e.target.value)} placeholder={t(locale, "ibanLabel")} className="ps-ltr" />

            <button type="submit">{t(locale, "save")}</button>
            {saved && <p style={{ color: "#1a7f4e" }}>✓</p>}
          </form>
        </>
      )}
    </main>
  );
}
