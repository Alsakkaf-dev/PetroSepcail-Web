import Link from "next/link";

export default function AdminHome() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>PetroSpecial Admin</h1>
      <p>
        <Link href="/catalog">Catalog — Prices &amp; Inventory (AC-02)</Link>
      </p>
    </main>
  );
}
