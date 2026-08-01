-- Up Migration
-- 50-loyalty-engine/04-database-design.md §2/3 (LE-DB-1/2, S19). `loyalty`
-- schema, owner LE; reads orders/credit facts only through events (never
-- reads/writes those tables directly, per this doc's own §0 rule).
-- `app_auth.jwt()` throughout, standing adaptation every RLS migration here
-- makes.

create schema loyalty;
grant usage on schema loyalty to app_user, app_service_role;

create table loyalty.points_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references core.identities(id) on delete restrict,
  kind        text not null check (kind in ('earn','redeem','reverse','expire','restore')),
  points      int not null,
  order_id    uuid,
  source_event_id uuid,
  earned_at   timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);
create index on loyalty.points_ledger (user_id, created_at);
create unique index points_idem on loyalty.points_ledger (kind, source_event_id) where source_event_id is not null;
comment on table loyalty.points_ledger is
  'LE-01 — APPEND-ONLY points ledger; balance = sum(points). Earn/redeem/reverse/expire/restore are entries, never mutations.';
revoke update, delete on loyalty.points_ledger from public;

create table loyalty.coupons (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  type          text not null check (type in ('percent','fixed')),
  value         numeric(12,2) not null check (value > 0),
  min_order     numeric(12,2) not null default 0,
  first_order_only boolean not null default false,
  per_user_limit int,
  usage_cap     int,
  used_count    int not null default 0,
  valid_from    timestamptz not null default now(),
  valid_until   timestamptz,
  eligibility_rule_id uuid,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
comment on table loyalty.coupons is 'LE-02 — coupon + constraints; authored via AC-04, evaluated here';

create table loyalty.coupon_redemptions (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references loyalty.coupons(id) on delete restrict,
  user_id     uuid not null references core.identities(id) on delete restrict,
  order_id    uuid not null,
  discount_sar numeric(12,2) not null,
  status      text not null default 'applied' check (status in ('applied','released')),
  created_at  timestamptz not null default now(),
  unique (coupon_id, order_id)
);
create index on loyalty.coupon_redemptions (user_id, coupon_id);
comment on table loyalty.coupon_redemptions is 'LE-02 — usage-cap enforcement + release on cancel';

create table loyalty.eligibility_rules (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tree        jsonb not null,
  created_by  uuid references core.identities(id),
  created_at  timestamptz not null default now()
);
comment on table loyalty.eligibility_rules is 'LE-04 — JSON condition tree; whitelisted fields/operators, bounded, side-effect-free';

alter table loyalty.coupons add constraint coupons_rule_fk foreign key (eligibility_rule_id) references loyalty.eligibility_rules(id);

create table loyalty.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null,
  name_en     text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  audience_rule_id uuid references loyalty.eligibility_rules(id),
  status      text not null default 'scheduled' check (status in ('scheduled','active','ended')),
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
comment on table loyalty.campaigns is 'LE-03 — scheduled offer window; start/end emit EV-PC-044';

create table loyalty.campaign_coupons (
  campaign_id uuid not null references loyalty.campaigns(id) on delete cascade,
  coupon_id   uuid not null references loyalty.coupons(id) on delete cascade,
  primary key (campaign_id, coupon_id)
);
comment on table loyalty.campaign_coupons is 'LE-03 — offers attached to a campaign';

create table loyalty.incentives (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references credit.suppliers(id) on delete restrict,
  kind        text not null check (kind in ('early_pay','volume')),
  basis       jsonb not null,
  value_sar   numeric(12,2) not null check (value_sar > 0),
  source_ref  text,
  created_at  timestamptz not null default now(),
  unique (supplier_id, kind, source_ref)
);
comment on table loyalty.incentives is 'LE-05/06 — granted supplier reward; emits EV-PC-043; SP-06 applies the credit note';

-- RLS
alter table loyalty.points_ledger enable row level security;
alter table loyalty.points_ledger force row level security;
create policy points_self_read on loyalty.points_ledger for select using (user_id = (app_auth.jwt()->>'sub')::uuid);
grant select on loyalty.points_ledger to app_user;

alter table loyalty.coupon_redemptions enable row level security;
alter table loyalty.coupon_redemptions force row level security;
create policy redemption_self_read on loyalty.coupon_redemptions for select using (user_id = (app_auth.jwt()->>'sub')::uuid);
grant select on loyalty.coupon_redemptions to app_user;

alter table loyalty.coupons enable row level security;
alter table loyalty.coupons force row level security;
create policy coupon_read on loyalty.coupons for select using (active and (valid_until is null or valid_until > now()));
grant select on loyalty.coupons to app_user;

alter table loyalty.campaigns enable row level security;
alter table loyalty.campaigns force row level security;
create policy campaign_read on loyalty.campaigns for select using (status in ('scheduled','active'));
grant select on loyalty.campaigns to app_user;

alter table loyalty.eligibility_rules enable row level security;
alter table loyalty.eligibility_rules force row level security;
create policy rule_admin_read on loyalty.eligibility_rules for select using (app_auth.jwt()->>'role' in ('admin','super_admin'));
grant select on loyalty.eligibility_rules to app_user;

alter table loyalty.incentives enable row level security;
alter table loyalty.incentives force row level security;
create policy incentive_supplier_read on loyalty.incentives for select using (supplier_id = (app_auth.jwt()->>'supplier_id')::uuid);
grant select on loyalty.incentives to app_user;

grant all privileges on all tables in schema loyalty to app_service_role;

-- Settings this schema's functions read that don't exist yet (points_per_sar/
-- redeem_rate/early_pay_days/early_pay_discount are already seeded, 0008).
insert into core.settings (key, value) values
  ('redeem_cap_pct', '0.50'),
  ('points_expiry_months', '12');

-- Down Migration

delete from core.settings where key in ('redeem_cap_pct', 'points_expiry_months');

revoke all privileges on all tables in schema loyalty from app_service_role;

revoke select on loyalty.incentives from app_user;
drop policy if exists incentive_supplier_read on loyalty.incentives;
alter table loyalty.incentives disable row level security;

revoke select on loyalty.eligibility_rules from app_user;
drop policy if exists rule_admin_read on loyalty.eligibility_rules;
alter table loyalty.eligibility_rules disable row level security;

revoke select on loyalty.campaigns from app_user;
drop policy if exists campaign_read on loyalty.campaigns;
alter table loyalty.campaigns disable row level security;

revoke select on loyalty.coupons from app_user;
drop policy if exists coupon_read on loyalty.coupons;
alter table loyalty.coupons disable row level security;

revoke select on loyalty.coupon_redemptions from app_user;
drop policy if exists redemption_self_read on loyalty.coupon_redemptions;
alter table loyalty.coupon_redemptions disable row level security;

revoke select on loyalty.points_ledger from app_user;
drop policy if exists points_self_read on loyalty.points_ledger;
alter table loyalty.points_ledger disable row level security;

drop table if exists loyalty.incentives;
drop table if exists loyalty.campaign_coupons;
drop table if exists loyalty.campaigns;
alter table loyalty.coupons drop constraint if exists coupons_rule_fk;
drop table if exists loyalty.eligibility_rules;
drop table if exists loyalty.coupon_redemptions;
drop table if exists loyalty.coupons;
drop table if exists loyalty.points_ledger;

revoke usage on schema loyalty from app_user, app_service_role;
drop schema if exists loyalty cascade;
