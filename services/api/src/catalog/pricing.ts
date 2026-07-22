import { withServiceRoleTransaction } from "../db.js";

// SF-01 (S07): `core.get_setting`'s own comment (0007_functions.sql, S01)
// is explicit — "server-side business logic that needs it for anonymous/
// customer flows (e.g. VAT display) calls it over a app_service_role
// connection", since `core.settings`' RLS (`settings_admin_read`) blocks
// app_user reads for non-admin actors, including the guest/customer callers
// every public catalog endpoint serves (FR-SF01-011).
export async function getVatRate(): Promise<number> {
  const value = await withServiceRoleTransaction(async (client) => {
    const res = await client.query<{ get_setting: string }>("select core.get_setting('vat_rate') as get_setting");
    return res.rows[0]?.get_setting;
  });
  return Number(value ?? 0);
}

// FR-SF01-004: displayed price = EP-X-004 (ex-VAT list price) × (1 + vat_rate),
// server-computed, rendered as a money string decimal (PC-04 convention).
export function priceInclVat(exVat: number, vatRate: number): string {
  return (exVat * (1 + vatRate)).toFixed(2);
}

export function money(value: number): string {
  return value.toFixed(2);
}
