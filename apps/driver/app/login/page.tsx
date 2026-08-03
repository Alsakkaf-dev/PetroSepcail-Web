"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "../../lib/authClient";
import { t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

// App Router requires any useSearchParams()-using component (useLocale())
// to sit under a <Suspense> boundary or static export fails — the exact
// production break S09 hit on apps/store when this wasn't done from the
// start (PROGRESS.md, "production build break found + fixed"). Applied here
// from the first page, not retrofitted after a broken deploy.
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
      router.push(`/shift?lang=${locale}`);
    } catch (err) {
      // authClient collapses every transport-level fetch failure into this
      // one code so it can be said in the driver's language here, instead of
      // surfacing the browser's raw "Failed to fetch".
      const message = err instanceof Error ? err.message : "";
      if (message === "NETWORK_UNREACHABLE") setError(t(locale, "errorNetwork"));
      else setError(message || t(locale, "errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"}>
      <h1>{t(locale, "appTitle")}</h1>
      <form onSubmit={onSubmit}>
        <input
          type="email"
          placeholder={t(locale, "emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder={t(locale, "passwordPlaceholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {t(locale, "signIn")}
        </button>
      </form>
    </main>
  );
}
