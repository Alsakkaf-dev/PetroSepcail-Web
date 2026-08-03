import Link from "next/link";

export default function AdminHome() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>PetroSpecial Admin</h1>
      <ul style={{ display: "grid", gap: 8, listStyle: "none", padding: 0 }}>
        <li>
          <Link href="/dashboard">Dashboard — Sales &amp; Fulfillment (AC-01)</Link>
        </li>
        <li>
          <Link href="/catalog">Catalog — Prices &amp; Inventory (AC-02)</Link>
        </li>
        <li>
          <Link href="/suppliers-credit">Suppliers &amp; Credit (AC-03)</Link>
        </li>
        <li>
          <Link href="/promotions">Promotions &amp; Loyalty (AC-04)</Link>
        </li>
        <li>
          <Link href="/interventions">Interventions (AC-05)</Link>
        </li>
        <li>
          <Link href="/users">User Management (AC-06)</Link>
        </li>
        <li>
          <Link href="/audit">Audit Log (AC-07)</Link>
        </li>
        <li>
          <Link href="/finance">Finance &amp; Receivables (AC-08)</Link>
        </li>
        <li>
          <Link href="/fleet">Fleet Oversight (AC-09)</Link>
        </li>
        <li>
          <Link href="/privacy">Privacy — PII Lookup (AC-10)</Link>
        </li>
      </ul>
    </main>
  );
}
