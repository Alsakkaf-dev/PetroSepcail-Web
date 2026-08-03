"use client";

import { useEffect, useState } from "react";
import { clearToken, getToken, login } from "./authClient";

// Shared login gate for every new admin page — see authClient.ts's own note.
export function LoginGate({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState("admin.seed@petrospecial.internal");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTokenState(getToken());
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await login(email, password);
      setTokenState(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  if (token === undefined) return null; // avoid a login-form flash before localStorage is read
  if (!token) {
    return (
      <form onSubmit={submit} style={{ maxWidth: 360, display: "grid", gap: 12 }}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
          />
        </label>
        {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
        <button type="submit" disabled={busy} style={{ padding: "8px 16px", borderRadius: 6, background: "var(--gold)", border: "none" }}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          clearToken();
          setTokenState(null);
        }}
        style={{ float: "inline-end", fontSize: 12 }}
      >
        Sign out
      </button>
      {children}
    </>
  );
}
