-- Up Migration
-- 20-delivery-logistics/04-database-design.md §3 (Task DL-DB-2, D-14) — the
-- van-stock half of the mobile-warehouse model. catalog.stock_locations/
-- stock_movements/record_stock_movement already exist (0022_stock_locations.sql,
-- built early during S07's catalog work in anticipation of D-14a) but that
-- version has no per-van materialized balance and no FK from
-- stock_locations to a van (delivery.vans didn't exist yet). This migration
-- is additive, not a rebuild: it links the existing tables to the delivery
-- schema this session just created and adds the one genuinely-missing piece
-- (a queryable current van balance — DL-01's eligibility gate needs "does
-- this van's stock cover every line" as a fast lookup, not a SUM() over the
-- whole movement ledger on every dispatch).
alter table catalog.stock_locations
  add column van_id uuid references delivery.vans(id) on delete cascade;
create unique index stock_locations_one_per_van on catalog.stock_locations (van_id) where van_id is not null;
comment on column catalog.stock_locations.van_id is 'D-14 — set iff kind=van; one stock_locations row per van';

alter table catalog.stock_movements
  add constraint stock_movements_driver_fk foreign key (driver_id) references delivery.drivers(id);

create table catalog.van_stock (
  location_id  uuid not null references catalog.stock_locations(id) on delete cascade,
  pack_size_id uuid not null references catalog.pack_sizes(id) on delete restrict,
  qty          int not null default 0 check (qty >= 0),
  updated_at   timestamptz not null default now(),
  primary key (location_id, pack_size_id)
);
comment on table catalog.van_stock is 'D-14 — mobile-warehouse on-hand per van; hub on-hand stays catalog.inventory (unchanged, D-14a)';
alter table catalog.van_stock enable row level security;
alter table catalog.van_stock force row level security;
grant all privileges on catalog.van_stock to app_service_role;

-- Extend the existing function (not replace its behavior, add to it): when a
-- leg's from/to location has kind='van', also maintain catalog.van_stock.
-- The hub branch is untouched (byte-for-byte the same logic as 0022) so
-- every existing caller (AC-02 hub adjustments) keeps working unchanged.
-- `set search_path` is applied inline this time (0033/0038's own lesson —
-- S09's 0037 CREATE OR REPLACE on a different function silently dropped
-- 0033's hardening because it wasn't in the same statement).
create or replace function catalog.record_stock_movement(
  p_pack uuid, p_qty int, p_from uuid, p_to uuid, p_kind text,
  p_driver uuid default null, p_created_by uuid default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, catalog, core
as $$
declare v_hub uuid; v_id uuid; v_from_kind text; v_to_kind text;
begin
  select id into v_hub from catalog.stock_locations where kind = 'hub' and is_active limit 1;

  -- Stock-sufficiency check BEFORE any write (05-api-specification.md §8
  -- STOCK_INSUFFICIENT/409; DL-SHIFT-2's own DoD: "atomic, rollback on
  -- short"). The pre-D-14 version of this function (0022) silently clamped
  -- at zero via greatest(qty,0) instead of ever raising — a real gap this
  -- extension closes, not just a van-stock addition.
  if p_from is not null then
    if p_from = v_hub then
      if (select qty_on_hand from catalog.inventory where pack_size_id = p_pack) < p_qty then
        raise exception 'STOCK_INSUFFICIENT' using errcode = '23514';
      end if;
    else
      if coalesce((select qty from catalog.van_stock where location_id = p_from and pack_size_id = p_pack), 0) < p_qty then
        raise exception 'STOCK_INSUFFICIENT' using errcode = '23514';
      end if;
    end if;
  end if;

  insert into catalog.stock_movements (pack_size_id, qty, from_location_id, to_location_id, kind, driver_id, created_by)
    values (p_pack, p_qty, p_from, p_to, p_kind, p_driver, p_created_by)
    returning id into v_id;

  if p_to = v_hub then
    update catalog.inventory set qty_on_hand = qty_on_hand + p_qty, updated_at = now()
      where pack_size_id = p_pack;
  elsif p_from = v_hub then
    update catalog.inventory set qty_on_hand = qty_on_hand - p_qty, updated_at = now()
      where pack_size_id = p_pack;
  end if;

  if p_to is not null then
    select kind into v_to_kind from catalog.stock_locations where id = p_to;
    if v_to_kind = 'van' then
      insert into catalog.van_stock (location_id, pack_size_id, qty) values (p_to, p_pack, p_qty)
        on conflict (location_id, pack_size_id) do update set qty = catalog.van_stock.qty + p_qty, updated_at = now();
    end if;
  end if;
  if p_from is not null then
    select kind into v_from_kind from catalog.stock_locations where id = p_from;
    if v_from_kind = 'van' then
      update catalog.van_stock set qty = qty - p_qty, updated_at = now()
        where location_id = p_from and pack_size_id = p_pack;
    end if;
  end if;

  insert into core.outbox (name, version, payload)                                   -- EV-PC-006
    values ('inventory.stock.transferred', 1,
      jsonb_build_object('movement_id', v_id, 'pack_size_id', p_pack, 'qty', p_qty,
                          'from_location_id', p_from, 'to_location_id', p_to,
                          'kind', p_kind, 'driver_id', p_driver));
  return v_id;
end $$;
comment on function catalog.record_stock_movement(uuid, int, uuid, uuid, text, uuid, uuid) is
  'D-14 — hub<->van stock-movement ledger write; adjusts hub inventory and/or van_stock, emits EV-PC-006';

-- catalog.stock_locations was force-RLS'd with ZERO policies in 0022
-- ("internal ops data, no end-user policy... admin routes read/write via
-- app_service_role") — forced RLS with no matching policy hides every row
-- from app_user regardless of GRANTs, so van_stock_driver_read below (which
-- joins into stock_locations) would silently see nothing without this. Scope
-- is narrow: a driver may see the id/van_id/kind of their OWN active van's
-- location row, nothing else in the table.
create policy stock_location_driver_read on catalog.stock_locations for select using (
  van_id is not null and exists (
    select 1 from delivery.shifts s where s.van_id = stock_locations.van_id
      and s.driver_id = (app_auth.jwt()->>'driver_id')::uuid and s.status <> 'closed'));
grant select on catalog.stock_locations to app_user;

-- van_stock read policy: a driver reads their own active shift's van balance
-- (04-database-design §4 "catalog van stock: a driver reads their own van's
-- stock; movement is SECURITY-DEFINER-only").
create policy van_stock_driver_read on catalog.van_stock for select using (
  exists (select 1 from catalog.stock_locations l join delivery.shifts s on s.van_id = l.van_id
          where l.id = van_stock.location_id and s.driver_id = (app_auth.jwt()->>'driver_id')::uuid and s.status <> 'closed'));
grant select on catalog.van_stock to app_user;

-- Down Migration

revoke select on catalog.van_stock from app_user;
drop policy if exists van_stock_driver_read on catalog.van_stock;
revoke select on catalog.stock_locations from app_user;
drop policy if exists stock_location_driver_read on catalog.stock_locations;

create or replace function catalog.record_stock_movement(
  p_pack uuid, p_qty int, p_from uuid, p_to uuid, p_kind text,
  p_driver uuid default null, p_created_by uuid default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog
as $$
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

  insert into core.outbox (name, version, payload)
    values ('inventory.stock.transferred', 1,
      jsonb_build_object('movement_id', v_id, 'pack_size_id', p_pack, 'qty', p_qty,
                          'from_location_id', p_from, 'to_location_id', p_to,
                          'kind', p_kind, 'driver_id', p_driver));
  return v_id;
end $$;

revoke all privileges on catalog.van_stock from app_service_role;
alter table catalog.van_stock disable row level security;
drop table if exists catalog.van_stock;

alter table catalog.stock_movements drop constraint if exists stock_movements_driver_fk;

drop index if exists catalog.stock_locations_one_per_van;
alter table catalog.stock_locations drop column if exists van_id;
