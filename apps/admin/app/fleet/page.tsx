"use client";

import type { FleetAlertsResponse, FleetKpisResponse } from "@petrospecial/contracts";
import { useEffect, useState } from "react";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

// AC-09 (S18). SCR-AC09-001. No live map yet (would need a MapLibre/OSM tile
// integration — DEFERRED-DECISIONS.md Section 3's own vendor-free default
// for maps, not wired into any frontend anywhere in this codebase yet); KPIs
// + alerts are real and live.
function FleetInner() {
  const [kpis, setKpis] = useState<FleetKpisResponse["rows"] | null>(null);
  const [alerts, setAlerts] = useState<FleetAlertsResponse["items"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([authedFetch<FleetKpisResponse>("/api/v1/admin/fleet/kpis"), authedFetch<FleetAlertsResponse>("/api/v1/admin/fleet/alerts")])
      .then(([k, a]) => {
        setKpis(k.rows);
        setAlerts(a.items);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load"));
  }, []);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Fleet Oversight (AC-09)</h1>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      <h2>Alerts</h2>
      {alerts && (
        <ul>
          {alerts.length === 0 && <li>No open alerts.</li>}
          {alerts.map((a, i) => (
            <li key={i}>
              [{a.severity}] {a.kind} — <span className="ps-ltr">{a.ref}</span>
            </li>
          ))}
        </ul>
      )}

      <h2>Driver KPIs</h2>
      {kpis && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Failed %</th>
            </tr>
          </thead>
          <tbody>
            {kpis.map((k) => (
              <tr key={k.driverId}>
                <td className="ps-ltr">{k.driverId}</td>
                <td>{k.failedPct ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function FleetPage() {
  return (
    <LoginGate>
      <FleetInner />
    </LoginGate>
  );
}
