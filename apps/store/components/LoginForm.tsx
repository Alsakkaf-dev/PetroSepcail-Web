"use client";

import { useState } from "react";
import { login } from "../lib/authClient";
import { dirFor, t, type Locale } from "../lib/locale";

// Shared across cart/orders/account (SF-03/05/10) — was three identical
// copies before AR/EN parity work needed a single place to add the locale
// prop.
export function LoginForm({
  locale,
  promptKey,
  onLoggedIn
}: {
  locale: Locale;
  promptKey: "loginToViewCart" | "loginToViewOrders" | "loginToViewAccount";
  onLoggedIn: () => void;
}) {
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
    <form onSubmit={submit} style={{ maxWidth: 320, display: "grid", gap: 12 }} dir={dirFor(locale)}>
      <p>{t(locale, promptKey)}</p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t(locale, "emailPlaceholder")}
        style={{ padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t(locale, "passwordPlaceholder")}
        style={{ padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
      />
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      <button type="submit" style={{ padding: "8px 16px", borderRadius: 6, background: "var(--gold)", border: "none" }}>
        {t(locale, "signIn")}
      </button>
    </form>
  );
}
