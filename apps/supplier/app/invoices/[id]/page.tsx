"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SupplierNav } from "../../../components/Nav";
import { authedFetch, clearToken, getToken } from "../../../lib/authClient";
import { dirFor, t } from "../../../lib/locale";
import { useLocale } from "../../../lib/useLocale";

interface InvoiceListItem {
  invoiceId: string;
  orderId: string;
  status: string;
  total: string;
  openBalance: string;
  issuedAt: string;
  dueAt: string;
  zatcaUuid: string | null;
}
interface InvoiceLine {
  nameAr: string;
  nameEn: string;
  qty: number;
  unitPrice: string;
  vatAmount: string;
  lineTotal: string;
}
interface InvoiceDetail {
  invoice: InvoiceListItem;
  lines: InvoiceLine[];
  qrTlv: string | null;
  deliveryDate: string | null;
}

function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("missing required env var NEXT_PUBLIC_API_URL");
  return `${base}${path}`;
}

// EP-SP-031/033/040 (SP-04/05, S15). UBL is real XML (content-type
// application/xml) — a plain <a href> can't attach the bearer token
// (separate origin, D-15), so it's fetched authenticated and handed to the
// browser as a Blob, same technique apps/admin's CSV export already uses.
async function downloadUbl(invoiceId: string): Promise<void> {
  const token = window.localStorage.getItem("ps-supplier-token");
  if (!token) return;
  const res = await fetch(apiUrl(`/api/v1/supplier/invoices/${invoiceId}/ubl`), { headers: { authorization: `Bearer ${token}` } });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoice-${invoiceId}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function InvoiceDetailPage() {
  return (
    <Suspense fallback={null}>
      <InvoiceDetailPageInner />
    </Suspense>
  );
}

function InvoiceDetailPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [amount, setAmount] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    authedFetch<InvoiceDetail>(`/api/v1/supplier/invoices/${params.id}`)
      .then((res) => {
        setDetail(res);
        setAmount(res.invoice.openBalance);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, router, params.id]);

  async function submitProof(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      // Real proof upload needs EP-PC-050 (media upload-url) + a real file
      // picker — this screen uses the same documented placeholder media id
      // apps/store's own bank-transfer-proof screen already established
      // (no file-upload UI wired into any app in this codebase yet).
      await authedFetch(`/api/v1/supplier/invoices/${params.id}/pay-proof`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), bankRef, proofMediaId: "00000000-0000-0000-0000-000000000000" })
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    }
  }

  function signOut() {
    clearToken();
    router.push(`/login?lang=${locale}`);
  }

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <SupplierNav locale={locale} onSignOut={signOut} />
      <h1>{t(locale, "invoiceDetailTitle")}</h1>
      {error && <p role="alert">{error}</p>}

      {detail && (
        <>
          <p>{t(locale, "statusLabel")} {detail.invoice.status}</p>
          <p className="ps-ltr">{t(locale, "issuedAtLabel")} {new Date(detail.invoice.issuedAt).toLocaleDateString()}</p>
          <p className="ps-ltr">{t(locale, "dueAtLabel")} {new Date(detail.invoice.dueAt).toLocaleDateString()}</p>
          <p className="ps-ltr" style={{ fontWeight: 700 }}>{t(locale, "openBalance")} {detail.invoice.openBalance}</p>

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
            <thead>
              <tr>
                <th>{locale === "ar" ? "الصنف" : "Item"}</th>
                <th>{t(locale, "qtyLabel")}</th>
                <th>{t(locale, "total")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l, i) => (
                <tr key={i}>
                  <td>{locale === "ar" ? l.nameAr : l.nameEn}</td>
                  <td>{l.qty}</td>
                  <td className="ps-ltr">{l.lineTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {detail.invoice.zatcaUuid && (
            // No PDF anchor: /invoices/{id}/pdf is a documented SPEC-GAP
            // (packages/contracts/src/sp-invoicing.ts's invoicePdfResponse
            // comment) — it returns a same-origin JSON pointer back to this
            // same detail endpoint, not real PDF bytes, since no PDF
            // renderer/object storage is wired anywhere in this codebase yet.
            // The UBL XML download below is the one real export this screen has.
            <p style={{ marginTop: 12 }}>
              <button type="button" onClick={() => downloadUbl(detail.invoice.invoiceId)}>{t(locale, "downloadUbl")}</button>
            </p>
          )}

          {detail.invoice.status !== "paid" && detail.invoice.status !== "written_off" && (
            <form onSubmit={submitProof} style={{ display: "grid", gap: 8, marginTop: 16, maxWidth: 320 }}>
              <h2 style={{ fontSize: 16 }}>{t(locale, "payProof")}</h2>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t(locale, "amountLabel")} className="ps-ltr" />
              <input value={bankRef} onChange={(e) => setBankRef(e.target.value)} placeholder={t(locale, "bankRefLabel")} />
              <button type="submit">{t(locale, "submitProof")}</button>
              {submitted && <p style={{ color: "#1a7f4e" }}>{t(locale, "pendingVerification")}</p>}
            </form>
          )}
        </>
      )}
    </main>
  );
}
