-- Up Migration
-- 20-delivery-logistics/04-database-design.md §2 (Task DL-DB-1) — the full
-- `delivery` schema, built upfront per the implementation guide's own
-- ordering ("1. Database (M3, first)" precedes even DL-07's onboarding
-- section). Only DL-01 (dispatch)/DL-04 (state machine) get real endpoints
-- this session (S10); location_pings/pods/driver_cash_custody/audit_* exist
-- now so DL-03/05/06/07 (S11/S12) don't need schema surgery on a live table,
-- same precedent as S07 creating catalog.stock_locations before DL existed.
create schema delivery;

-- 2.1 drivers ---------------------------------------------------------------
create table delivery.drivers (
  id           uuid primary key default gen_random_uuid(),
  identity_id  uuid not null unique references core.identities(id) on delete restrict,
  license_no   text,
  license_media_id uuid references core.media_objects(id),
  vehicle_desc text,
  default_van_id uuid,                                  -- -> delivery.vans; FK added after vans exists (below)
  rating       numeric(3,2) not null default 5.00 check (rating between 0 and 5),
  status       text not null default 'active' check (status in ('active','suspended')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table delivery.drivers is 'DL-07 — driver master; drivers.id == JWT driver_id claim';

-- 2.2 vans --------------------------------------------------------------------
create table delivery.vans (
  id          uuid primary key default gen_random_uuid(),
  plate       text not null unique,
  capacity_liters numeric(9,2),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table delivery.vans is 'DL-07 — vehicle; each active van has a catalog.stock_locations(kind=van) row';

alter table delivery.drivers add constraint drivers_default_van_fk
  foreign key (default_van_id) references delivery.vans(id) on delete set null;

-- 2.3 shifts ------------------------------------------------------------------
create table delivery.shifts (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references delivery.drivers(id) on delete restrict,
  van_id       uuid references delivery.vans(id) on delete restrict,
  status       text not null default 'open' check (status in ('open','reconciling','closed')),
  available    boolean not null default true,          -- FR-DL07-008 (break/unavailable)
  opening_stock jsonb,
  closing_variance jsonb,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create unique index one_open_shift_per_driver on delivery.shifts (driver_id) where status <> 'closed';
comment on table delivery.shifts is 'DL-07 — load-out at start, reconcile + remit at end';

-- 2.4 delivery_tasks ------------------------------------------------------------
-- delivery_status (D-04, core) already exists (0002_enum_types.sql) —
-- referenced, never redefined, per this doc's own §0 rule.
create table delivery.delivery_tasks (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders.orders(id) on delete restrict,
  order_kind       text not null check (order_kind in ('retail','wholesale')),
  fulfillment_type text not null check (fulfillment_type in ('home_delivery','pickup_point')),
  stop_type        text not null check (stop_type in ('b2b_drop','b2c_home','b2c_pickup')),
  address_id       uuid,
  pickup_location_id uuid,
  driver_id        uuid references delivery.drivers(id) on delete set null,
  shift_id         uuid references delivery.shifts(id) on delete set null,
  status           delivery_status not null default 'assigned',
  cod_amount       numeric(12,2),
  eta              timestamptz,
  route_sequence   int,
  source_event_id  uuid unique,                          -- EV-PC-013 dedupe (FR-DL01-001 idempotency)
  assigned_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ( (fulfillment_type='home_delivery' and address_id is not null)
       or (fulfillment_type='pickup_point'  and pickup_location_id is not null) )
);
create index on delivery.delivery_tasks (driver_id, status);
create index on delivery.delivery_tasks (status) where status not in ('delivered','confirmed','failed');
comment on table delivery.delivery_tasks is 'DL-04 — one per order (EV-PC-013); typed for the unified manifest (D-14)';
create trigger set_updated_at before update on delivery.delivery_tasks
  for each row execute function moddatetime(updated_at);

-- 2.5 task_events (transition log) ----------------------------------------------
create table delivery.task_events (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references delivery.delivery_tasks(id) on delete cascade,
  from_status delivery_status,
  to_status   delivery_status not null,
  at          timestamptz not null default now(),
  lat numeric(9,6), lng numeric(9,6),
  actor_id    uuid,
  client_action_id text
);
create unique index task_event_idem on delivery.task_events (task_id, client_action_id) where client_action_id is not null;
comment on table delivery.task_events is 'DL-04 — every transition; drives EV-PC-021';

-- 2.6 location_pings (PDPL-retained; DL-03, S11) --------------------------------
create table delivery.location_pings (
  id        bigint generated always as identity primary key,
  task_id   uuid not null references delivery.delivery_tasks(id) on delete cascade,
  driver_id uuid not null references delivery.drivers(id) on delete cascade,
  lat numeric(9,6) not null, lng numeric(9,6) not null,
  heading numeric(5,2), speed numeric(6,2),
  at timestamptz not null default now(),
  client_ping_id text
);
create index on delivery.location_pings (task_id, at);
create unique index ping_idem on delivery.location_pings (task_id, client_ping_id) where client_ping_id is not null;
comment on table delivery.location_pings is 'DL-03 (S11) — 5s cadence while en_route; purged after 30 days (PDPL, FR-DL03-003)';

-- 2.7 pods (immutable proof; DL-05, S12) ----------------------------------------
create table delivery.pods (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null unique references delivery.delivery_tasks(id) on delete restrict,
  photo_media_id uuid not null references core.media_objects(id),
  otp_verified  boolean not null default false,
  collector_kind text not null check (collector_kind in ('customer','supplier')),
  lat numeric(9,6), lng numeric(9,6),
  captured_at   timestamptz not null default now()
);
comment on table delivery.pods is 'DL-05 (S12) — photo + OTP; immutable once captured (FR-DL05-007)';
revoke update, delete on delivery.pods from public;

-- 2.8 driver_cash_custody (Custody Funds — driver side; DL-05/07, S11/S12) ------
create table delivery.driver_cash_custody (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references delivery.drivers(id) on delete restrict,
  order_id     uuid not null references orders.orders(id) on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),
  status       text not null default 'held' check (status in ('held','remitted')),
  collected_at timestamptz not null default now(),
  remitted_at  timestamptz,
  remittance_ref uuid
);
create index on delivery.driver_cash_custody (driver_id, status);
comment on table delivery.driver_cash_custody is
  'D-14 rule f — company cash a driver holds on our behalf. NOT credit. Never joined to credit.invoices/exposure.';
revoke update, delete on delivery.driver_cash_custody from public;

-- 2.9 audit_schedules / stock_audits (D-14 rule g; DL-06, S12) ------------------
create table delivery.audit_schedules (
  id          uuid primary key default gen_random_uuid(),
  entity_kind text not null check (entity_kind in ('driver','supplier')),
  entity_id   uuid not null,
  interval_days int not null,
  next_due    date not null,
  updated_by  uuid references core.identities(id),
  updated_at  timestamptz not null default now(),
  unique (entity_kind, entity_id)
);
comment on table delivery.audit_schedules is
  'D-14 rule g — per-entity audit cadence; default from core.settings.audit_cadence_default (monthly); no redeploy to change';

create table delivery.stock_audits (
  id          uuid primary key default gen_random_uuid(),
  entity_kind text not null check (entity_kind in ('driver','supplier')),
  entity_id   uuid not null,
  status      text not null default 'open' check (status in ('open','closed','exception')),
  variance    jsonb,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz
);
comment on table delivery.stock_audits is 'DL-06 (S12) — audit instance; closes with EV-PC-028; over-tolerance => DL-09 exception';

-- Down Migration

drop table if exists delivery.stock_audits;
drop table if exists delivery.audit_schedules;
drop table if exists delivery.driver_cash_custody;
drop table if exists delivery.pods;
drop table if exists delivery.location_pings;
drop table if exists delivery.task_events;
drop table if exists delivery.delivery_tasks;
drop table if exists delivery.shifts;
alter table delivery.drivers drop constraint if exists drivers_default_van_fk;
drop table if exists delivery.vans;
drop table if exists delivery.drivers;
drop schema if exists delivery cascade;
