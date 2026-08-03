"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

// App Router requires any useSearchParams()-using component (useLocale())
// to sit under a <Suspense> boundary or static export fails — same
// production break S09 hit on apps/store, applied from the first page here
// (same precedent apps/driver's login page already set).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.push(`/dashboard?lang=${locale}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 360, margin: "0 auto", padding: 24 }}>
      <h1>{t(locale, "appTitle")}</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input
          type="email"
          placeholder={t(locale, "emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 8 }}
          required
        />
        <input
          type="password"
          placeholder={t(locale, "passwordPlaceholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 8 }}
          required
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? t(locale, "loading") : t(locale, "signIn")}
        </button>
      </form>
    </main>
  );
}
