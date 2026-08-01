import type { PoolClient } from "pg";

// SF-03 (S08) stub -> LE-02 (S19) real implementation. The original stub's
// own comment promised "callers never change" but the real validator
// genuinely needs the caller's id and the order total (min_order/per-user-
// limit/first-order checks can't be done without them) -- the stub never
// checked anything real, so it never needed them. `loyalty.validate_coupon`
// (0070) is SECURITY DEFINER and does the actual work; this is a thin
// pass-through, not a second copy of the logic.
export interface CouponResult {
  valid: boolean;
  discountSar: number | null;
  reasonAr: string | null;
  reasonEn: string | null;
}

export async function validateCoupon(client: PoolClient, code: string, userId: string, orderTotal: number): Promise<CouponResult> {
  const res = await client.query<{ result: { valid: boolean; discountSar: string | null; reasonAr: string | null; reasonEn: string | null } }>(
    "select loyalty.validate_coupon($1, $2, $3) as result",
    [code, userId, orderTotal]
  );
  const result = res.rows[0]?.result;
  return {
    valid: result?.valid ?? false,
    discountSar: result?.discountSar !== null && result?.discountSar !== undefined ? Number(result.discountSar) : null,
    reasonAr: result?.reasonAr ?? null,
    reasonEn: result?.reasonEn ?? null
  };
}
