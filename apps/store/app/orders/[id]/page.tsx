"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { authedFetch } from "../../../lib/authClient";
import { dirFor, localeDateTimeString, orderStatusLabel, otherLocale, t } from "../../../lib/locale";
import { useLocale } from "../../../lib/useLocale";

interface OrderDetail {
  orderId: string;
  status: string;
  paymentMethod: "cod" | "bank_transfer";
  total: string;
  codAmount: string | null;
  slot: string;
  lines: Array<{ nameAr: string; nameEn: string; qty: number; lineTotal: string }>;
  payment: { status: string } | null;
  payTo?: { iban: string; holder: string };
  timeline: Array<{ status: string; at: string }>;
}

// SF-05 (S09) — FR-SF05-007/006: cancel only before 'preparing'; confirm
// receipt only from 'delivered'. Mirrors the same status set the backend
// enforces (orders.cancel_order/confirm_receipt, db/migrations/0035/0037).
const CANCELLABLE_STATUSES = new Set(["pending_payment", "paid", "confirmed"]);

// useLocale() (useSearchParams) requires a Suspense boundary in the Next.js
// App Router static-export path, or `next build` fails at prerender.
export default function OrderConfirmationPage() {
  return (
    <Suspense fallback={null}>
      <OrderConfirmationPageInner />
    </Suspense>
  );
}

function OrderConfirmationPageInner() {
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bankRef, setBankRef] = useState("");
  const [proofSubmitted, setProofSubmitted] = useState(false);

  useEffect(() => {
    authedFetch<OrderDetail>(`/api/v1/orders/${params.id}`)
      .then(setOrder)
      .catch((err) => setError(err instanceof Error ? err.message : "failed"));
  }, [params.id]);

  async function cancelOrder() {
    if (!order) return;
    try {
      const res = await authedFetch<{ status: string }>(`/api/v1/orders/${order.orderId}/cancel`, { method: "POST" });
      setOrder({ ...order, status: res.status });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function confirmReceipt() {
    if (!order) return;
    try {
      const res = await authedFetch<{ status: string }>(`/api/v1/orders/${order.orderId}/confirm-receipt`, { method: "POST" });
      setOrder({ ...order, status: res.status });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function submitProof(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    try {
      // Real proof upload needs EP-PC-050 (media upload-url) + a real file;
      // this demo path uses a placeholder media id since no file picker is
      // wired into this screen yet — DoD is the order/proof plumbing itself.
      await authedFetch(`/api/v1/orders/${order.orderId}/bank-transfer-proof`, {
        method: "POST",
        body: JSON.stringify({ amount: order.total, bankRef, proofMediaId: "00000000-0000-0000-0000-000000000000" })
      });
      setProofSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  if (error) return <p style={{ color: "#b91c1c", padding: 24 }}>{error}</p>;
  if (!order) return <p style={{ padding: 24 }}>{t(locale, "loading")}</p>;

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>{t(locale, "orderConfirmed")}</h1>
        <Link href={`/orders/${order.orderId}?lang=${otherLocale(locale)}`}>{t(locale, "switchLang")}</Link>
      </header>
      <p>
        {t(locale, "orderNumber")} <span className="ps-ltr">{order.orderId}</span>
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i}>
              <td>{locale === "ar" ? l.nameAr : l.nameEn}</td>
              <td>× {l.qty}</td>
              <td className="ps-ltr">
                {l.lineTotal} {t(locale, "sar")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontWeight: 700 }}>
        {t(locale, "total")} <span className="ps-ltr">{order.total} {t(locale, "sar")}</span>
      </p>

      <section style={{ margin: "16px 0" }}>
        <h2 style={{ fontSize: 16 }}>{t(locale, "statusHistory")}</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {order.timeline.map((tl, i) => (
            <li key={i} style={{ fontSize: 13, color: "var(--muted)" }}>
              {orderStatusLabel(locale, tl.status)} — {localeDateTimeString(locale, tl.at)}
            </li>
          ))}
        </ul>
      </section>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {CANCELLABLE_STATUSES.has(order.status) && (
          <button type="button" onClick={cancelOrder}>
            {t(locale, "cancelOrder")}
          </button>
        )}
        {order.status === "delivered" && (
          <button type="button" onClick={confirmReceipt}>
            {t(locale, "confirmReceipt")}
          </button>
        )}
      </div>

      {order.paymentMethod === "cod" && (
        <p>
          {t(locale, "codDueLabel")} <span className="ps-ltr">{order.codAmount} {t(locale, "sar")}</span>
        </p>
      )}

      {order.paymentMethod === "bank_transfer" && order.payTo && (
        <section style={{ padding: 16, background: "var(--bg-warm)", borderRadius: 8 }}>
          <p>{t(locale, "transferAmountTo")}</p>
          <p className="ps-ltr">
            IBAN: {order.payTo.iban} ({order.payTo.holder})
          </p>
          {order.payment?.status === "pending" || proofSubmitted ? (
            <p>{t(locale, "proofReceivedPendingVerification")}</p>
          ) : (
            <form onSubmit={submitProof} style={{ display: "grid", gap: 8 }}>
              <input placeholder={t(locale, "bankRefPlaceholder")} value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
              <button type="submit">{t(locale, "submitProof")}</button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
