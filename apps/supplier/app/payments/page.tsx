"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface PaymentItem {
  paymentId: string;
  invoiceId: string;
  amount: string;
  verifiedAt: string;
}

// EP-SP-041 (SP-05, S15).
export default function PaymentsPage() {
  return (
    <Suspense fallback={null}>
      <PaymentsPageInner />
    </Suspense>
  );
}

function PaymentsPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<PaymentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    authedFetch<{ items: PaymentItem[] }>("/api/v1/supplier/payments?limit=50")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }, [locale, router]);


  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1>{t(locale, "paymentsTitle")}</h1>
      {error && <p role="alert">{error}</p>}
      {items && items.length === 0 && <p>{t(locale, "noPayments")}</p>}
      {items && items.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>{t(locale, "amountLabel")}</th>
              <th>{t(locale, "verifiedAtLabel")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.paymentId}>
                <td className="ps-ltr">{p.amount}</td>
                <td>{new Date(p.verifiedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
