"use client";

import type { AdminSkuListResponse } from "@petrospecial/contracts";
import { useEffect, useState } from "react";

// AC-02 (S07). This is a client component (runs in the browser, a different
// origin from the API under the Vercel pivot, D-15 — no Caddy same-origin
// proxy exists anymore), so every call is built into an absolute URL from
// NEXT_PUBLIC_API_URL (the browser-safe counterpart of the server-only
// API_URL apps/store/lib/api.ts uses).
//
// No console shell/session yet (AC-M5-0 is a later, separate M5 task) — this
// page is a self-contained login + CRUD screen, not wired into a broader
// authenticated layout.

function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("missing required env var NEXT_PUBLIC_API_URL");
  return `${base}${path}`;
}

interface Row {
  skuId: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  packSizeId: string;
  sizeLabel: string;
  retailPrice: string | null;
  qtyOnHand: number;
  reserved: number;
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}`, "content-type": "application/json" }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? `${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function LoginForm({ onLoggedIn }: { onLoggedIn: (token: string) => void }) {
  const [email, setEmail] = useState("admin.seed@petrospecial.internal");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Login failed");
      onLoggedIn(body.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

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

function RowEditor({ row, token, onSaved }: { row: Row; token: string; onSaved: (row: Row) => void }) {
  const [price, setPrice] = useState(row.retailPrice ?? "0.00");
  const [qty, setQty] = useState(row.qtyOnHand);
  const [status, setStatus] = useState<string | null>(null);

  async function savePrice() {
    setStatus("saving price…");
    try {
      await api("/api/v1/admin/catalog/prices", token, {
        method: "PUT",
        body: JSON.stringify({ packSizeId: row.packSizeId, retailPrice: price })
      });
      setStatus("price saved");
      onSaved({ ...row, retailPrice: price });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "failed");
    }
  }

  async function saveInventory() {
    setStatus("saving stock…");
    try {
      await api("/api/v1/admin/catalog/inventory", token, {
        method: "PUT",
        body: JSON.stringify({ packSizeId: row.packSizeId, qtyOnHand: qty })
      });
      setStatus("stock saved");
      onSaved({ ...row, qtyOnHand: qty });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "failed");
    }
  }

  return (
    <tr>
      <td>{row.nameAr}</td>
      <td className="ps-ltr">{row.nameEn}</td>
      <td className="ps-ltr">{row.sizeLabel}</td>
      <td>
        <input value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 80 }} />
        <button onClick={savePrice} type="button">
          Save
        </button>
      </td>
      <td>
        <input
          type="number"
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          style={{ width: 70 }}
        />
        <button onClick={saveInventory} type="button">
          Save
        </button>
      </td>
      <td style={{ fontSize: 12, color: "var(--muted)" }}>{status}</td>
    </tr>
  );
}

export default function AdminCatalogPage() {
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api<AdminSkuListResponse>("/api/v1/admin/catalog/skus", token)
      .then((res) => setRows(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load"));
  }, [token]);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Catalog — Prices &amp; Inventory (AC-02)</h1>

      {!token && <LoginForm onLoggedIn={setToken} />}

      {token && error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {token && rows && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Name (AR)</th>
              <th>Name (EN)</th>
              <th>Size</th>
              <th>Retail price (ex-VAT)</th>
              <th>Qty on hand</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RowEditor
                key={row.packSizeId}
                row={row}
                token={token}
                onSaved={(updated) => setRows((prev) => prev!.map((r) => (r.packSizeId === updated.packSizeId ? updated : r)))}
              />
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
