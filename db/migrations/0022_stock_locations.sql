-- Up Migration
-- D-14a (00-master/PROGRESS.md, hybrid fulfillment & mobile-warehouse model):
-- "Inventory gains a *location dimension*: the Jeddah hub is the single
-- source of truth; each driver/van is a mobile stock sub-ledger; goods move
-- hub<->van via a stock-movement ledger... New tables (authored in AC-02/
-- catalog + DL, never core): catalog.stock_locations (kind: hub|van|office),
-- catalog.stock_movements." catalog.inventory (0019) stays the hub's own
-- qty_on_hand/reserved row per pack size, unchanged, per D-14a's explicit
-- "still ONE fulfillment origin of truth, NOT multi-warehouse" — van-level
-- balances are derived from this ledger, not a second inventory row. Van/
-- driver locations don't exist until DL-07 (S11) onboards drivers; this
-- session only needs the hub location to exist so AC-02's own hub-inventory
-- adjustments (EP-AC-013) have a location to attribute the movement to.
create table catalog.stock_locations (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('hub','van','office')),
  name_ar    text not null, name_en text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table catalog.stock_locations is 'D-14a — hub/van/office stock locations; AC-02/DL write';

create table catalog.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  pack_size_id    uuid not null references catalog.pack_sizes(id) on delete restrict,
  qty             int not null check (qty <> 0),
  from_location_id uuid references catalog.stock_locations(id),
  to_location_id   uuid references catalog.stock_locations(id),
  kind            text not null check (kind in ('load','return','adjust')),
  driver_id       uuid,   -- set iff a van leg (delivery.drivers doesn't exist until S10/S11 — same
                          -- deferred-FK precedent as 0004_core_schema.sql's role_grants.driver_id)
  created_by      uuid references core.identities(id),   -- admin actor for 'adjust'; null for driver-initiated legs
  created_at      timestamptz not null default now(),
  check (from_location_id is not null or to_location_id is not null)
);
create index on catalog.stock_movements (pack_size_id);
comment on table catalog.stock_movements is 'D-14a — hub<->van stock-movement ledger; emits EV-PC-006';

-- RLS: internal ops data (D-14a "authored in AC-02/catalog + DL"), no
-- end-user policy — same defense-in-depth-with-zero-policy pattern as
-- core.auth_tokens (0006_rls_policies.sql). Admin routes read/write these via
-- service_role (withServiceRoleTransaction), matching config.ts's precedent.
alter table catalog.stock_locations enable row level security;
alter table catalog.stock_locations force row level security;

alter table catalog.stock_movements enable row level security;
alter table catalog.stock_movements force row level security;

grant all privileges on catalog.stock_locations, catalog.stock_movements to service_role;

-- Down Migration

revoke all privileges on catalog.stock_locations, catalog.stock_movements from service_role;

alter table catalog.stock_movements disable row level security;
alter table catalog.stock_locations disable row level security;

drop table if exists catalog.stock_movements;
drop table if exists catalog.stock_locations;
