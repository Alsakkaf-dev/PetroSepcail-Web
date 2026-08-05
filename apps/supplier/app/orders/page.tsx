"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface OrderItem {
  orderId: string;
  status: string;
  total: string;
  placedAt: string;
}
interface ReorderLine {
  packSizeId: string;
  skuSlug: string;
  qty: number;
  tierUnitPrice: string;
}
interface ReorderDropped {
  skuSlug: string;
  reason: "discontinued" | "out_of_stock";
}

// EP-SP-004/005 (SP-01, S14) + EP-SP-072 (SP-09, S16) — cancel and reorder
// both act on this list; reorder re-prices at the current tier and drops
// discontinued/out-of-stock lines with a notice (FR-SP09-002) rather than
// silently omitting them.
export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersPageInner />
    </Suspense>
  );
}

function OrdersPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<OrderItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<ReorderDropped[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    authedFetch<{ items: OrderItem[] }>("/api/v1/supplier/orders?limit=50")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, router]);

  async function cancelOrder(orderId: string) {
    setBusyId(orderId);
    try {
      await authedFetch(`/api/v1/supplier/orders/${orderId}/cancel`, { method: "POST" });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusyId(null);
    }
  }

  async function reorder(orderId: string) {
    setBusyId(orderId);
    setDropped([]);
    try {
      const result = await authedFetch<{ lines: ReorderLine[]; dropped: ReorderDropped[] }>(
        `/api/v1/supplier/orders/${orderId}/reorder`,
        { method: "POST" }
      );
      for (const line of result.lines) {
        await authedFetch("/api/v1/supplier/cart", { method: "POST", body: JSON.stringify({ packSizeId: line.packSizeId, qty: line.qty }) });
      }
      setDropped(result.dropped);
      router.push(`/cart?lang=${locale}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusyId(null);
    }
  }


  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>{t(locale, "ordersTitle")}</h1>
      {error && <p role="alert">{error}</p>}
      {dropped.length > 0 && (
        <p style={{ color: "var(--flame, #b45309)" }}>
          {t(locale, "droppedLinesNotice")} ({dropped.map((d) => d.skuSlug).join(", ")})
        </p>
      )}

      {items && items.length === 0 && <p>{t(locale, "noOrders")}</p>}

      {items && items.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>{t(locale, "statusLabel")}</th>
              <th>{t(locale, "total")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.orderId}>
                <td>{o.status}</td>
                <td className="ps-ltr">{o.total}</td>
                <td style={{ display: "flex", gap: 8 }}>
                  <Link href={`/orders/${o.orderId}?lang=${locale}`}>{t(locale, "viewTracking")}</Link>
                  <button type="button" disabled={busyId === o.orderId} onClick={() => reorder(o.orderId)}>
                    {t(locale, "reorder")}
                  </button>
                  {o.status === "pending_payment" && (
                    <button type="button" disabled={busyId === o.orderId} onClick={() => cancelOrder(o.orderId)}>
                      {t(locale, "cancelOrder")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
