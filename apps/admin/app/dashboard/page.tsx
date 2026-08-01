"use client";

import type { FulfillmentAnalyticsResponse, SalesAnalyticsResponse } from "@petrospecial/contracts";
import { useEffect, useState } from "react";
import { authedFetch, getToken } from "../../lib/authClient.js";
import { LoginGate } from "../../lib/LoginGate.js";

function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("missing required env var NEXT_PUBLIC_API_URL");
  return `${base}${path}`;
}

// A plain <a href> can't attach the bearer token (browsers never send custom
// Authorization headers on anchor navigation, and this API is a separate
// origin, D-15 — no session cookie exists to fall back on either), so the
// export is fetched authenticated and handed to the browser as a Blob.
async function downloadCsv(): Promise<void> {
  const token = getToken();
  if (!token) return;
  const res = await fetch(apiUrl("/api/v1/admin/analytics/export"), { headers: { authorization: `Bearer ${token}` } });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sales-kpi.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// AC-01 (S17). SCR-AC01-001. k>=5 anonymity-floored aggregates only — no
// per-customer row ever appears here (NFR-AC-001/002).
function DashboardInner() {
  const [sales, setSales] = useState<SalesAnalyticsResponse | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      authedFetch<SalesAnalyticsResponse>("/api/v1/admin/analytics/sales"),
      authedFetch<FulfillmentAnalyticsResponse>("/api/v1/admin/analytics/fulfillment")
    ])
      .then(([s, f]) => {
        setSales(s);
        setFulfillment(f);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load"));
  }, []);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Dashboard — Sales &amp; Fulfillment (AC-01)</h1>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {fulfillment && (
        <section style={{ display: "flex", gap: 24, margin: "16px 0" }}>
          <div>
            <strong>Fulfillment rate</strong>
            <div>{fulfillment.fulfillmentRate !== null ? `${fulfillment.fulfillmentRate.toFixed(1)}%` : "—"}</div>
          </div>
          <div>
            <strong>Failed %</strong>
            <div>{fulfillment.failedPct !== null ? `${fulfillment.failedPct}%` : "—"}</div>
          </div>
        </section>
      )}

      {sales && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <caption style={{ textAlign: "left", fontSize: 12, color: "var(--muted)" }}>as of {new Date(sales.asOf).toLocaleString()}</caption>
          <thead>
            <tr>
              <th>Day</th>
              <th>Kind</th>
              <th>Orders</th>
              <th>Buyers</th>
              <th>Gross (SAR)</th>
              <th>Discounts</th>
              <th>Reversed</th>
            </tr>
          </thead>
          <tbody>
            {sales.rows.map((r, i) => (
              <tr key={`${r.day}-${r.kind}-${i}`}>
                <td>{r.day}</td>
                <td>{r.kind}</td>
                <td>{r.orders}</td>
                <td>{r.buyers}</td>
                <td>{r.gross}</td>
                <td>{r.discounts}</td>
                <td>{r.reversed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 16 }}>
        <button type="button" onClick={() => void downloadCsv()}>
          Export CSV
        </button>{" "}
        (same aggregate table shown above — no per-customer export exists).
      </p>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <LoginGate>
      <DashboardInner />
    </LoginGate>
  );
}
