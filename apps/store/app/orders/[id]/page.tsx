"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { authedFetch } from "../../../lib/authClient";

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
}

export default function OrderConfirmationPage() {
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
  if (!order) return <p style={{ padding: 24 }}>جارٍ التحميل...</p>;

  return (
    <main dir="rtl" style={{ maxWidth: 600, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>تم تأكيد الطلب</h1>
      <p>
        رقم الطلب: <span className="ps-ltr">{order.orderId}</span>
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.nameAr}</td>
              <td>× {l.qty}</td>
              <td className="ps-ltr">{l.lineTotal} SAR</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontWeight: 700 }}>
        الإجمالي: <span className="ps-ltr">{order.total} SAR</span>
      </p>

      {order.paymentMethod === "cod" && (
        <p>الدفع نقدًا عند الاستلام — المبلغ المستحق: <span className="ps-ltr">{order.codAmount} SAR</span></p>
      )}

      {order.paymentMethod === "bank_transfer" && order.payTo && (
        <section style={{ padding: 16, background: "var(--bg-warm)", borderRadius: 8 }}>
          <p>حوّل المبلغ إلى:</p>
          <p className="ps-ltr">
            IBAN: {order.payTo.iban} ({order.payTo.holder})
          </p>
          {order.payment?.status === "pending" || proofSubmitted ? (
            <p>تم استلام إثبات التحويل — بانتظار التحقق.</p>
          ) : (
            <form onSubmit={submitProof} style={{ display: "grid", gap: 8 }}>
              <input placeholder="رقم مرجع التحويل" value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
              <button type="submit">إرسال إثبات التحويل</button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
