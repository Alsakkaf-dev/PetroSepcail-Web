-- Up Migration
-- Supabase security advisor (ERROR, rls_disabled_in_public): loyalty.campaign_coupons was
-- created in 0069 alongside every other loyalty table, but 0069's own "-- RLS" section at
-- the bottom never included it - every sibling table (points_ledger, coupons, campaigns,
-- coupon_redemptions, eligibility_rules) got its own enable/force/policy/grant block and
-- this one was simply missed. Confirmed live via get_advisors: RLS was not just "no policy"
-- (default-deny under force) but fully disabled, open to anon/authenticated.
--
-- No route currently reads this join table directly - it exists to attach coupons to a
-- campaign - so there is no currently-working caller to preserve. The policy mirrors
-- campaign_read (0069) exactly: a row is visible only while its own campaign is visible
-- (scheduled or active), the same condition already governing whether the campaign and its
-- coupons are independently readable.
alter table loyalty.campaign_coupons enable row level security;
alter table loyalty.campaign_coupons force row level security;
create policy campaign_coupons_read on loyalty.campaign_coupons for select using (
  exists (
    select 1 from loyalty.campaigns c
    where c.id = campaign_id and c.status in ('scheduled', 'active')
  )
);
grant select on loyalty.campaign_coupons to app_user;

-- Down Migration

revoke select on loyalty.campaign_coupons from app_user;
drop policy if exists campaign_coupons_read on loyalty.campaign_coupons;
alter table loyalty.campaign_coupons disable row level security;
