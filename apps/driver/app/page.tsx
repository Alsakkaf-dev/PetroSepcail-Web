import Link from "next/link";

// DL-01/04/07 (S10/S11) — login/shift/manifest/task screens now exist;
// POD/pickup/exception/audit/KPI screens (SCR-DL05/08/09/06) wait on their
// own backends (DL-05/06/08/09, S12) since there is nothing for them to show yet.
export default function DriverHome() {
  return (
    <main>
      <h1>PetroSpecial Driver</h1>
      <Link href="/login">Sign in</Link>
    </main>
  );
}
