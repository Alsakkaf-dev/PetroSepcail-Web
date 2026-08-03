"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SupplierNav } from "../../components/Nav";
import { authedFetch, clearToken, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface InvoiceItem {
  invoiceId: string;
  orderId: string;
  status: string;
  total: string;
  openBalance: string;
  issuedAt: string;
  dueAt: string;
  zatcaUuid: string | null;
}

// EP-SP-030 (SP-04, S15).
export default function InvoicesPage() {
  return (
    <Suspense fallback={null}>
      <InvoicesPageInner />
    </Suspense>
  );
}

function InvoicesPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<InvoiceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    authedFetch<{ items: InvoiceItem[] }>("/api/v1/supplier/invoices?limit=50")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }, [locale, router]);

  function signOut() {
    clearToken();
    router.push(`/login?lang=${locale}`);
  }

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <SupplierNav locale={locale} onSignOut={signOut} />
      <h1>{t(locale, "invoicesTitle")}</h1>
      {error && <p role="alert">{error}</p>}
      {items && items.length === 0 && <p>{t(locale, "noInvoices")}</p>}

      {items && items.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>{t(locale, "statusLabel")}</th>
              <th>{t(locale, "total")}</th>
              <th>{t(locale, "openBalance")}</th>
              <th>{t(locale, "dueAtLabel")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((inv) => (
              <tr key={inv.invoiceId}>
                <td>{inv.status}</td>
                <td className="ps-ltr">{inv.total}</td>
                <td className="ps-ltr">{inv.openBalance}</td>
                <td>{new Date(inv.dueAt).toLocaleDateString()}</td>
                <td>
                  <Link href={`/invoices/${inv.invoiceId}?lang=${locale}`}>{t(locale, "invoiceDetailTitle")}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
