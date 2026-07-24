"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authedFetch, getToken, login } from "../../lib/authClient";

interface OrderListItem {
  orderId: string;
  status: string;
  total: string;
  paymentMethod: string;
  placedAt: string;
  slot: string;
}

const STATUS_LABELS_AR: Record<string, string> = {
  pending_payment: "بانتظار الدفع",
  paid: "تم الدفع",
  confirmed: "مؤكد",
  preparing: "قيد التجهيز",
  ready_for_pickup: "جاهز للتسليم",
  assigned: "تم تعيين سائق",
  picked_up: "تم الاستلام من المستودع",
  en_route: "في الطريق",
  delivered: "تم التوصيل",
  confirmed_received: "تم تأكيد الاستلام",
  cancelled: "ملغى",
  refunded: "مسترد",
  returned: "مرتجع"
};

function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("customer.seed@petrospecial.internal");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, display: "grid", gap: 12 }} dir="rtl">
      <p>سجّل الدخول لعرض طلباتك</p>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="البريد الإلكتروني" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور" />
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      <button type="submit">دخول</button>
    </form>
  );
}

// EP-SF-030 / FR-SF10-003 (S09) — order history list, linking to SF-05's
// existing order detail page (orders/[id]).
export default function OrdersListPage() {
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
    <main dir="rtl" style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>طلباتي</h1>

      {!loggedIn && <LoginForm onLoggedIn={() => setLoggedIn(true)} />}
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {loggedIn && items && items.length === 0 && <p>لا توجد طلبات سابقة.</p>}

      {loggedIn && items && items.length > 0 && (
        <div style={{ display: "grid", gap: 12 }}>
          {items.map((o) => (
            <Link
              key={o.orderId}
              href={`/orders/${o.orderId}`}
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
                <p style={{ margin: 0, fontWeight: 700 }}>{STATUS_LABELS_AR[o.status] ?? o.status}</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                  {new Date(o.placedAt).toLocaleDateString("ar-SA")}
                </p>
              </div>
              <span className="ps-ltr">{o.total} SAR</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
