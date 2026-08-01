"use client";

import type { AdminReadCustomerResponse } from "@petrospecial/contracts";
import { useState } from "react";
import { authedFetch } from "../../lib/authClient.js";
import { LoginGate } from "../../lib/LoginGate.js";

// AC-10 (S18). SCR-AC10-001. The ONLY customer-PII read path — single
// record, reason mandatory, audit-first (core.admin_read_customer). No list/
// search-by-anything exists here by design (NFR-AC-002/003) — a customer id
// must already be known.
function PrivacyInner() {
  const [customerId, setCustomerId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<AdminReadCustomerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await authedFetch<AdminReadCustomerResponse>("/api/v1/admin/customers/read", {
        method: "POST",
        body: JSON.stringify({ customerId, reason })
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "lookup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Privacy — Single-Record PII Lookup (AC-10)</h1>
      <p style={{ color: "var(--muted)" }}>This action is logged. A reason is required and cannot be blank.</p>

      <form onSubmit={lookup} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
        <label>
          Customer ID (UUID)
          <input value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ display: "block", width: "100%", padding: 8 }} />
        </label>
        <label>
          Reason (mandatory, logged)
          <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ display: "block", width: "100%", padding: 8 }} />
        </label>
        {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Looking up..." : "Look up (this will be logged)"}
        </button>
      </form>

      {result && (
        <dl style={{ marginTop: 16 }}>
          <dt>Full name</dt>
          <dd>{result.fullName}</dd>
          <dt>Phone</dt>
          <dd className="ps-ltr">{result.phone}</dd>
          <dt>Email</dt>
          <dd className="ps-ltr">{result.email}</dd>
          <dt>Status</dt>
          <dd>{result.status}</dd>
        </dl>
      )}
    </main>
  );
}

export default function PrivacyPage() {
  return (
    <LoginGate>
      <PrivacyInner />
    </LoginGate>
  );
}
