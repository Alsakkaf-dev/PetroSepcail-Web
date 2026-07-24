"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoginForm } from "../../components/LoginForm";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, localeDateString, orderStatusLabel, otherLocale, t, useLocale } from "../../lib/locale";

interface OrderListItem {
  orderId: string;
  status: string;
  total: string;
  paymentMethod: string;
  placedAt: string;
  slot: string;
}

// EP-SF-030 / FR-SF10-003 (S09) — order history list, linking to SF-05's
// existing order detail page (orders/[id]).
export default function OrdersListPage() {
  const locale = useLocale();
  const [loggedIn, setLoggedIn] = useState(false);
  const [items, setItems] = useState<OrderListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(!!getToken());
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    authedFetch<{ items: OrderListItem[] }>("/api/v1/orders")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : "failed"));
  }, [loggedIn]);

  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>{t(locale, "myOrders")}</h1>
        <Link href={`/orders?lang=${otherLocale(locale)}`}>{t(locale, "switchLang")}</Link>
      </header>

      {!loggedIn && <LoginForm locale={locale} promptKey="loginToViewOrders" onLoggedIn={() => setLoggedIn(true)} />}
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {loggedIn && items && items.length === 0 && <p>{t(locale, "noOrdersYet")}</p>}

      {loggedIn && items && items.length > 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {items.map((o) => (
            <Link
              key={o.orderId}
              href={`/orders/${o.orderId}?lang=${locale}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: 12,
                border: "1px solid var(--line)",
                borderRadius: 8,
                textDecoration: "none",
                color: "inherit"
              }}
            >
              <div>
                <p style={{ margin: 0, fontWeight: 700 }}>{orderStatusLabel(locale, o.status)}</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>{localeDateString(locale, o.placedAt)}</p>
              </div>
              <span className="ps-ltr">
                {o.total} {t(locale, "sar")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
