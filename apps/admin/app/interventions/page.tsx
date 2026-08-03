"use client";

import type { InterventionListResponse } from "@petrospecial/contracts";
import { useEffect, useState } from "react";
import { authedFetch } from "../../lib/authClient.js";
import { LoginGate } from "../../lib/LoginGate.js";

// AC-05 (S18). SCR-AC05-001. Reason codes are the fixed list
// audit.reason_codes seeds (0064) — free-text reasons are rejected
// server-side (INVALID_REASON_CODE), so this screen offers the same fixed
// set rather than a free-text field.
const REASON_CODES = [
  "customer_request",
  "fraud_suspected",
  "address_unreachable",
  "stock_unavailable",
  "duplicate_order",
  "payment_issue",
  "quality_complaint",
  "policy_violation",
  "other_with_note"
];

function InterventionsInner() {
  const [items, setItems] = useState<InterventionListResponse["items"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [cancelOrderId, setCancelOrderId] = useState("");
  const [cancelReason, setCancelReason] = useState(REASON_CODES[0]);
  const [cancelNote, setCancelNote] = useState("");

  const [returnId, setReturnId] = useState("");
  const [returnDecision, setReturnDecision] = useState<"approve" | "reject">("approve");
  const [returnReason, setReturnReason] = useState(REASON_CODES[0]);

  const [reviewId, setReviewId] = useState("");
  const [reviewAction, setReviewAction] = useState<"hide" | "remove">("hide");
  const [reviewReason, setReviewReason] = useState(REASON_CODES[0]);

  function load() {
    authedFetch<InterventionListResponse>("/api/v1/admin/interventions")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load"));
  }

  useEffect(load, []);

  async function forceCancel(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      const res = await authedFetch<{ status: string }>(`/api/v1/admin/orders/${cancelOrderId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reasonCode: cancelReason, note: cancelNote || undefined })
      });
      setStatus(`Order ${cancelOrderId}: ${res.status}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function decideReturn(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      const res = await authedFetch<{ status: string }>(`/api/v1/admin/returns/${returnId}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision: returnDecision, reasonCode: returnReason })
      });
      setStatus(`Return ${returnId}: ${res.status}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function moderateReview(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      const res = await authedFetch<{ status: string }>(`/api/v1/admin/reviews/${reviewId}/moderate`, {
        method: "POST",
        body: JSON.stringify({ action: reviewAction, reasonCode: reviewReason })
      });
      setStatus(`Review ${reviewId}: ${res.status}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Interventions (AC-05)</h1>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      {status && <p style={{ color: "#1a7f4e" }}>{status}</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginBottom: 24 }}>
        <form onSubmit={forceCancel} style={{ display: "grid", gap: 8, flex: "1 1 260px" }}>
          <h2 style={{ fontSize: 14 }}>Force-cancel order (EP-AC-041)</h2>
          <input placeholder="Order ID" value={cancelOrderId} onChange={(e) => setCancelOrderId(e.target.value)} className="ps-ltr" />
          <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}>
            {REASON_CODES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input placeholder="Note (optional)" value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} />
          <button type="submit">Cancel order</button>
        </form>

        <form onSubmit={decideReturn} style={{ display: "grid", gap: 8, flex: "1 1 260px" }}>
          <h2 style={{ fontSize: 14 }}>Decide return (EP-AC-043)</h2>
          <input placeholder="Return ID" value={returnId} onChange={(e) => setReturnId(e.target.value)} className="ps-ltr" />
          <select value={returnDecision} onChange={(e) => setReturnDecision(e.target.value as "approve" | "reject")}>
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
          </select>
          <select value={returnReason} onChange={(e) => setReturnReason(e.target.value)}>
            {REASON_CODES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button type="submit">Submit decision</button>
        </form>

        <form onSubmit={moderateReview} style={{ display: "grid", gap: 8, flex: "1 1 260px" }}>
          <h2 style={{ fontSize: 14 }}>Moderate review (EP-AC-044)</h2>
          <input placeholder="Review ID" value={reviewId} onChange={(e) => setReviewId(e.target.value)} className="ps-ltr" />
          <select value={reviewAction} onChange={(e) => setReviewAction(e.target.value as "hide" | "remove")}>
            <option value="hide">Hide</option>
            <option value="remove">Remove</option>
          </select>
          <select value={reviewReason} onChange={(e) => setReviewReason(e.target.value)}>
            {REASON_CODES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button type="submit">Moderate</button>
        </form>
      </div>

      <h2 style={{ fontSize: 16 }}>Recent interventions</h2>
      {items && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>At</th>
              <th>Kind</th>
              <th>Order</th>
              <th>Reason</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.kind}</td>
                <td className="ps-ltr">{r.orderId}</td>
                <td>{r.reasonCode}</td>
                <td>{r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function InterventionsPage() {
  return (
    <LoginGate>
      <InterventionsInner />
    </LoginGate>
  );
}
