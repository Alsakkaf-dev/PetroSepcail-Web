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

-- Single hub location (D-14a: "the Jeddah hub is the single source of
-- truth"). Van/office locations are created later as drivers onboard
-- (DL-07, S11) / as needed; none exist yet.
insert into catalog.stock_locations (kind, name_ar, name_en)
values ('hub', 'المستودع الرئيسي — جدة', 'Jeddah Hub');

-- catalog.record_stock_movement (D-14a: "catalog.reserve_stock becomes
-- location-aware" sibling — the actual ledger-write primitive named in
-- EV-PC-006's producer column, 06-integration-contracts.md). A leg that
-- touches the hub adjusts catalog.inventory.qty_on_hand (the hub row is the
-- single source of truth, D-14a); a van/office-only leg (not used until
-- DL-07+) does not. SECURITY DEFINER so a future driver-side (app_user+RLS)
-- caller can invoke it despite catalog.inventory/core.outbox being
-- service_role-only tables — same pattern as catalog.reserve_stock/
-- release_stock (04-database-design §5).
create function catalog.record_stock_movement(
  p_pack uuid, p_qty int, p_from uuid, p_to uuid, p_kind text,
  p_driver uuid default null, p_created_by uuid default null
) returns uuid language plpgsql security definer as $$
declare v_hub uuid; v_id uuid;
begin
  select id into v_hub from catalog.stock_locations where kind = 'hub' and is_active limit 1;

  insert into catalog.stock_movements (pack_size_id, qty, from_location_id, to_location_id, kind, driver_id, created_by)
    values (p_pack, p_qty, p_from, p_to, p_kind, p_driver, p_created_by)
    returning id into v_id;

  if p_to = v_hub then
    update catalog.inventory set qty_on_hand = qty_on_hand + p_qty, updated_at = now()
      where pack_size_id = p_pack;
  elsif p_from = v_hub then
    update catalog.inventory set qty_on_hand = greatest(qty_on_hand - p_qty, 0), updated_at = now()
      where pack_size_id = p_pack;
  end if;

  insert into core.outbox (name, version, payload)                                   -- EV-PC-006
    values ('inventory.stock.transferred', 1,
      jsonb_build_object('movement_id', v_id, 'pack_size_id', p_pack, 'qty', p_qty,
                          'from_location_id', p_from, 'to_location_id', p_to,
                          'kind', p_kind, 'driver_id', p_driver));
  return v_id;
end $$;
comment on function catalog.record_stock_movement(uuid, int, uuid, uuid, text, uuid, uuid) is
  'D-14a — hub<->van stock-movement ledger write; adjusts the hub inventory row and emits EV-PC-006';

grant execute on function catalog.record_stock_movement(uuid, int, uuid, uuid, text, uuid, uuid) to app_user, service_role;

-- Down Migration

revoke execute on function catalog.record_stock_movement(uuid, int, uuid, uuid, text, uuid, uuid) from app_user, service_role;
drop function if exists catalog.record_stock_movement(uuid, int, uuid, uuid, text, uuid, uuid);

revoke all privileges on catalog.stock_locations, catalog.stock_movements from service_role;

alter table catalog.stock_movements disable row level security;
alter table catalog.stock_locations disable row level security;

drop table if exists catalog.stock_movements;
drop table if exists catalog.stock_locations;
