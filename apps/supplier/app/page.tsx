import Link from "next/link";

// SP-01..09 (S14-S16, backend-complete since S20) — this scaffold is the
// first frontend against the already-real /api/v1/supplier/* routes.
export default function SupplierHome() {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 24, textAlign: "center" }}>
      <h1>PetroSpecial Supplier Portal</h1>
      <Link href="/login">Sign in</Link>
    </main>
  );
}
