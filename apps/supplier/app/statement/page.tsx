"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface StatementLine {
  kind: "invoice" | "payment" | "credit_note";
  refId: string;
  amount: string;
  at: string;
}
interface StatementResponse {
  opening: string;
  invoicesTotal: string;
  paymentsTotal: string;
  creditNotesTotal: string;
  closing: string;
  aging: { b0_30: string; b31_60: string; b61_90: string; b90plus: string };
  lines: StatementLine[];
}

function defaultPeriod(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// EP-SP-050 (SP-06, S16) — debt-only ledger; custody has its own screen
// (/custody), never blended here (D-14 rule f).
export default function StatementPage() {
  return (
    <Suspense fallback={null}>
      <StatementPageInner />
    </Suspense>
  );
}

function StatementPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const initial = defaultPeriod();
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [statement, setStatement] = useState<StatementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch<StatementResponse>(
        `/api/v1/supplier/statement?periodStart=${periodStart}&periodEnd=${periodEnd}`
      );
      setStatement(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusy(false);
    }
  }


  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1>{t(locale, "statementTitle")}</h1>
      {error && <p role="alert">{error}</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 16 }}>
        <label>
          {t(locale, "periodStart")}
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} style={{ display: "block" }} />
        </label>
        <label>
          {t(locale, "periodEnd")}
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} style={{ display: "block" }} />
        </label>
        <button type="button" disabled={busy} onClick={generate}>
          {t(locale, "generateStatement")}
        </button>
      </div>

      {statement && (
        <>
          <p className="ps-ltr">{t(locale, "opening")} {statement.opening}</p>
          <p className="ps-ltr">{t(locale, "invoicesTotal")} {statement.invoicesTotal}</p>
          <p className="ps-ltr">{t(locale, "paymentsTotal")} {statement.paymentsTotal}</p>
          <p className="ps-ltr">{t(locale, "creditNotesTotal")} {statement.creditNotesTotal}</p>
          <p className="ps-ltr" style={{ fontWeight: 700 }}>{t(locale, "closing")} {statement.closing}</p>

          {statement.lines.length === 0 ? (
            <p>{t(locale, "noActivity")}</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
              <thead>
                <tr>
                  <th>{locale === "ar" ? "النوع" : "Kind"}</th>
                  <th>{t(locale, "amountLabel")}</th>
                  <th>{locale === "ar" ? "التاريخ" : "Date"}</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.kind}</td>
                    <td className="ps-ltr">{l.amount}</td>
                    <td>{new Date(l.at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}
