"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { otherLocale, t, type Locale } from "../lib/locale";

// 30-supplier-portal/06-ui-ux-specification.md §2: "A left rail (RTL: right
// rail) nav: Dashboard, Order (catalog+cart), Invoices, Statement, Payments,
// Custody, Tracking, Templates, Profile." Rendered as a top link row (not a
// literal sidebar) — same flat-nav density every other app in this codebase
// (driver/admin) already uses, RTL-mirrored automatically by flexbox + dir.
const NAV_ITEMS: Array<{ href: string; key: string }> = [
  { href: "/dashboard", key: "navDashboard" },
  { href: "/catalog", key: "navCatalog" },
  { href: "/cart", key: "navCart" },
  { href: "/orders", key: "navOrders" },
  { href: "/invoices", key: "navInvoices" },
  { href: "/payments", key: "navPayments" },
  { href: "/custody", key: "navCustody" },
  { href: "/statement", key: "navStatement" },
  { href: "/templates", key: "navTemplates" },
  { href: "/rewards", key: "navRewards" },
  { href: "/profile", key: "navProfile" }
];

export function SupplierNav({ locale, onSignOut }: { locale: Locale; onSignOut: () => void }) {
  const pathname = usePathname();
  return (
    <nav style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid #ddd", marginBottom: 16 }}>
      {NAV_ITEMS.map((item) => (
        <Link key={item.href} href={`${item.href}?lang=${locale}`} style={{ fontSize: 14 }}>
          {t(locale, item.key as Parameters<typeof t>[1])}
        </Link>
      ))}
      <Link href={`${pathname}?lang=${otherLocale(locale)}`} style={{ fontSize: 14, marginInlineStart: "auto" }}>
        {t(locale, "switchLang")}
      </Link>
      <button type="button" onClick={onSignOut} style={{ fontSize: 14 }}>
        {t(locale, "signOut")}
      </button>
    </nav>
  );
}
