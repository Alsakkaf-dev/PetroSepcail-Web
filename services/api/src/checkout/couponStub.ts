// SF-03 (S08): EP-X-002 (`POST /api/v1/loyalty/validate-coupon`) is LE-02's
// endpoint (06-integration-contracts.md) — LE-02 doesn't exist until S19.
// Per the roadmap's own explicit instruction ("coupon seam (LE-02 stub
// honoring contract)"), every code is rejected with a bilingual reason,
// never a discount — this is what "no wrong charge" (NFR-SF-002,
// FR-SF04-013) demands from a dependency that isn't real yet. LE-02 (S19)
// replaces this module's body only; callers (routes/cart.ts) never change.
export interface CouponResult {
  valid: false;
  discountSar: null;
  reasonAr: string;
  reasonEn: string;
}

export async function validateCoupon(_code: string): Promise<CouponResult> {
  return {
    valid: false,
    discountSar: null,
    reasonAr: "الكوبونات غير متاحة حاليًا",
    reasonEn: "Coupons are not available yet"
  };
}
