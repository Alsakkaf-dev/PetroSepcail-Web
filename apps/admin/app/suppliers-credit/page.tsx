"use client";

import type { AdminSupplierListResponse } from "@petrospecial/contracts";
import { useEffect, useState } from "react";
import { authedFetch } from "../../lib/authClient.js";
import { LoginGate } from "../../lib/LoginGate.js";

// AC-03 (S17). SCR-AC03-001. A dual-control request (>SAR 100,000) returns
// status "pending_dual_control" instead of applying — this screen surfaces
// that state as-is rather than silently retrying, since acknowledging it
// requires a genuinely different super_admin (EP-AC-022, not built into this
// screen yet — the ack endpoint exists and is callable, just not wired to a
// UI control here).
function SuppliersCreditInner() {
  const [items, setItems] = useState<AdminSupplierListResponse["items"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});

  function load() {
    authedFetch<AdminSupplierListResponse>("/api/v1/admin/suppliers")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load"));
  }

  useEffect(load, []);

  async function saveLimit(supplierId: string) {
    const newLimit = Number(drafts[supplierId]);
    if (!newLimit || newLimit <= 0) return;
    setBusyId(supplierId);
    try {
      const res = await authedFetch<{ status: string; newLimit?: string }>(`/api/v1/admin/suppliers/${supplierId}/credit-limit`, {
        method: "PUT",
        body: JSON.stringify({ newLimit, reason: "admin console adjustment" })
      });
      setStatus((s) => ({ ...s, [supplierId]: res.status === "pending_dual_control" ? "pending a second admin's ack" : `applied: ${res.newLimit}` }));
      load();
    } catch (err) {
      setStatus((s) => ({ ...s, [supplierId]: err instanceof Error ? err.message : "failed" }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Suppliers &amp; Credit (AC-03)</h1>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      {items && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Business (EN)</th>
              <th>Tier</th>
              <th>Credit limit</th>
              <th>Exposure</th>
              <th>Headroom</th>
              <th>Set new limit</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.supplierId}>
                <td>{r.businessNameEn}</td>
                <td>{r.tier}</td>
                <td>{r.creditLimit}</td>
                <td>{r.exposure}</td>
                <td>{r.headroom}</td>
                <td>
                  <input
                    style={{ width: 90 }}
                    value={drafts[r.supplierId] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.supplierId]: e.target.value }))}
                    placeholder="SAR"
                  />
                  <button type="button" disabled={busyId === r.supplierId} onClick={() => saveLimit(r.supplierId)}>
                    Save
                  </button>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{status[r.supplierId]}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function SuppliersCreditPage() {
  return (
    <LoginGate>
      <SuppliersCreditInner />
    </LoginGate>
  );
}
