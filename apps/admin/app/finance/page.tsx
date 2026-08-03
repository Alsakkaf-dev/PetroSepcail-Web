"use client";

import type { AdminCustodyResponse, ReceivablesResponse, VerificationQueueResponse } from "@petrospecial/contracts";
import { useEffect, useState } from "react";
import { authedFetch } from "../../lib/authClient.js";
import { LoginGate } from "../../lib/LoginGate.js";

// AC-08 (S18). SCR-AC08-001. Receivables/aging = SP-03's own
// credit.v_exposure/v_receivables_aging verbatim (NFR-AC-007); the custody
// panel here never carries a debt figure in the same object (D-14 rule f).
function FinanceInner() {
  const [receivables, setReceivables] = useState<ReceivablesResponse["items"] | null>(null);
  const [queue, setQueue] = useState<VerificationQueueResponse["items"] | null>(null);
  const [custody, setCustody] = useState<AdminCustodyResponse["holders"] | null>(null);
  const [remitAmounts, setRemitAmounts] = useState<Record<string, string>>({});
  const [writeOffInvoiceId, setWriteOffInvoiceId] = useState("");
  const [writeOffReason, setWriteOffReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function load() {
    Promise.all([
      authedFetch<ReceivablesResponse>("/api/v1/admin/finance/receivables"),
      authedFetch<VerificationQueueResponse>("/api/v1/admin/finance/verification-queue"),
      authedFetch<AdminCustodyResponse>("/api/v1/admin/finance/custody")
    ])
      .then(([r, q, c]) => {
        setReceivables(r.items);
        setQueue(q.items);
        setCustody(c.holders);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load"));
  }

  useEffect(load, []);

  async function verifyBankTransfer(refId: string) {
    setStatus(null);
    try {
      await authedFetch(`/api/v1/admin/finance/bank-transfer/${refId}/verify`, { method: "POST", body: JSON.stringify({}) });
      setStatus(`Payment proof ${refId}: verified`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function verifyRemittance(refId: string) {
    const amount = Number(remitAmounts[refId]);
    if (!amount || amount <= 0) return;
    setStatus(null);
    try {
      const res = await authedFetch<{ status: string }>(`/api/v1/admin/finance/custody/${refId}/verify-remittance`, {
        method: "POST",
        body: JSON.stringify({ amount })
      });
      setStatus(`Custody ${refId}: ${res.status}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function writeOff(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      const res = await authedFetch<{ status: string }>(`/api/v1/admin/finance/invoices/${writeOffInvoiceId}/write-off`, {
        method: "POST",
        body: JSON.stringify({ reason: writeOffReason })
      });
      setStatus(`Invoice ${writeOffInvoiceId}: ${res.status}`);
      setWriteOffInvoiceId("");
      setWriteOffReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Finance &amp; Receivables (AC-08)</h1>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      {status && <p style={{ color: "#1a7f4e" }}>{status}</p>}

      <h2 style={{ fontSize: 16 }}>Receivables aging</h2>
      {receivables && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Exposure</th>
              <th>Limit</th>
              <th>0-30</th>
              <th>31-60</th>
              <th>61-90</th>
              <th>90+</th>
            </tr>
          </thead>
          <tbody>
            {receivables.map((r) => (
              <tr key={r.supplierId}>
                <td className="ps-ltr">{r.supplierId}</td>
                <td>{r.exposure}</td>
                <td>{r.creditLimit}</td>
                <td>{r.aging.b0_30}</td>
                <td>{r.aging.b31_60}</td>
                <td>{r.aging.b61_90}</td>
                <td>{r.aging.b90plus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 16 }}>Verification queue</h2>
      {queue && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Ref</th>
              <th>Amount</th>
              <th>Submitted by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {queue.map((item) => (
              <tr key={item.refId}>
                <td>{item.kind}</td>
                <td className="ps-ltr">{item.refId}</td>
                <td>{item.claimedAmount}</td>
                <td className="ps-ltr">{item.submittedBy}</td>
                <td>
                  {item.kind === "bank_transfer" ? (
                    <button type="button" onClick={() => verifyBankTransfer(item.refId)}>Verify</button>
                  ) : (
                    <>
                      <input
                        style={{ width: 90 }}
                        placeholder="SAR"
                        value={remitAmounts[item.refId] ?? item.claimedAmount}
                        onChange={(e) => setRemitAmounts((m) => ({ ...m, [item.refId]: e.target.value }))}
                      />
                      <button type="button" onClick={() => verifyRemittance(item.refId)}>Verify remittance</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 16 }}>Custody Funds oversight (debt-free view, D-14 rule f)</h2>
      {custody && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Holder</th>
              <th>Held</th>
              <th>Remitted</th>
            </tr>
          </thead>
          <tbody>
            {custody.map((h) => (
              <tr key={`${h.holderKind}-${h.holderId}`}>
                <td className="ps-ltr">{h.holderKind}: {h.holderId}</td>
                <td>{h.heldTotal}</td>
                <td>{h.remittedTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: 16 }}>Write off invoice (EP-AC-074)</h2>
      <form onSubmit={writeOff} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
        <input placeholder="Invoice ID" value={writeOffInvoiceId} onChange={(e) => setWriteOffInvoiceId(e.target.value)} className="ps-ltr" />
        <input placeholder="Reason" value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)} />
        <button type="submit">Write off</button>
      </form>
    </main>
  );
}

export default function FinancePage() {
  return (
    <LoginGate>
      <FinanceInner />
    </LoginGate>
  );
}
