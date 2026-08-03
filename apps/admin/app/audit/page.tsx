"use client";

import type { AuditLogResponse, VerifyChainResponse } from "@petrospecial/contracts";
import { useEffect, useState } from "react";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

// AC-07 (S18). SCR-AC07-001. Read-only + verify-chain. An `admin` sees only
// their own entries; `super_admin` sees all (the API itself enforces this,
// not this screen).
function AuditInner() {
  const [items, setItems] = useState<AuditLogResponse["items"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<VerifyChainResponse | null>(null);

  useEffect(() => {
    authedFetch<AuditLogResponse>("/api/v1/admin/audit")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load"));
  }, []);

  async function verifyChain() {
    try {
      setChain(await authedFetch<VerifyChainResponse>("/api/v1/admin/audit/verify-chain"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "verify failed (super_admin only)");
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Audit Log (AC-07)</h1>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      <p>
        <button type="button" onClick={verifyChain}>
          Verify hash chain (super_admin)
        </button>{" "}
        {chain && (chain.intact ? "chain intact" : `BROKEN at rows: ${chain.brokenAt?.join(", ")}`)}
      </p>

      {items && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>At</th>
              <th>Role</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Resource ID</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={i}>
                <td>{new Date(r.at).toLocaleString()}</td>
                <td>{r.role}</td>
                <td>{r.action}</td>
                <td>{r.resource}</td>
                <td className="ps-ltr">{r.resourceId}</td>
                <td>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function AuditPage() {
  return (
    <LoginGate>
      <AuditInner />
    </LoginGate>
  );
}
