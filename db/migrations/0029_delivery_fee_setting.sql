-- Up Migration
-- SF-04 (S08): `EP-X-005` (delivery quote) is DL-01's endpoint (06-integration-
-- contracts.md) and DL-01 doesn't exist until S10 — this session implements
-- the contract's literal shape ({in_radius, fee_sar, slots}) as an in-process
-- seam inside checkout itself (services/api/src/checkout/deliveryQuote.ts),
-- per the roadmap's own stub-seam pattern (cf. SF-03's coupon/LE-02 seam).
-- `delivery_radius_km` already exists (0008_seed.sql); a flat delivery fee
-- for the in-radius, below-free-threshold case did not — [BUSINESS-CONFIRM]
-- placeholder, superseded once DL-01 owns real zone/distance-based pricing.
insert into core.settings (key, value) values
  ('delivery_fee_flat', '15.00');

-- Down Migration

delete from core.settings where key = 'delivery_fee_flat';
