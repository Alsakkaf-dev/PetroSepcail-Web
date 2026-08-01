-- Up Migration
-- 30-supplier-portal S14 resume step 3 (MASTER-ROADMAP.md) — seeds
-- catalog.tier_prices for every active pack size x 3 tiers, so
-- catalog.resolve_tier_price (0054) returns a real value instead of null.
-- Discount percentages (bronze 5% / silver 10% / gold 15% off the same
-- retail ex-VAT catalog.prices.list_price) are DEFERRED-DECISIONS.md item 11
-- (D-17 default, appended alongside this migration — no discount schedule
-- was specified anywhere in platform-docs).
insert into catalog.tier_prices (pack_size_id, tier, unit_price)
select p.id, t.tier, round(pr.list_price * t.multiplier, 2)
from catalog.pack_sizes p
join catalog.prices pr on pr.pack_size_id = p.id and pr.is_current
cross join (values ('bronze', 0.95), ('silver', 0.90), ('gold', 0.85)) as t(tier, multiplier)
where p.is_active;

-- Down Migration

delete from catalog.tier_prices;
