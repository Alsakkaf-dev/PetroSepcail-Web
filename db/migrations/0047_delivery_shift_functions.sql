-- Up Migration
-- DL-07 (S11): Task DL-SHIFT-1/2/3 — shift start (load-out), reconcile+
-- remit+close. 03-sdd.md §4's own sequence diagram for shift start.
-- SCOPED SIMPLIFICATION (documented, D-17 style): EP-DL-006's spec says
-- close requires "zero/acknowledged variance" — no acknowledge mechanism is
-- specified anywhere (not in 03-sdd.md, not in the error table), so
-- inventing one would be guessing an undocumented business rule. This
-- session implements the unambiguous half only: zero variance required to
-- close. A future session can add an explicit acknowledge action once the
-- business rule for it is actually written down somewhere.
create function delivery.start_shift(p_driver_id uuid, p_van_id uuid, p_load jsonb)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, delivery, catalog, core
as $$
declare
  v_hub uuid; v_van_location uuid; v_shift uuid; v_line jsonb;
begin
  if exists (select 1 from delivery.shifts where driver_id = p_driver_id and status <> 'closed') then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;

  select id into v_hub from catalog.stock_locations where kind = 'hub' and is_active limit 1;
  select id into v_van_location from catalog.stock_locations where van_id = p_van_id;
  if v_van_location is null then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;

  -- INSUFFICIENT_STOCK from record_stock_movement aborts the whole function
  -- (single plpgsql call = single transaction) — "atomic, rollback on
  -- short" (DL-SHIFT-2 DoD) falls out of that for free, no manual rollback needed.
  for v_line in select * from jsonb_array_elements(p_load)
  loop
    perform catalog.record_stock_movement(
      (v_line->>'packSizeId')::uuid, (v_line->>'qty')::int, v_hub, v_van_location, 'load', p_driver_id);
  end loop;

  insert into delivery.shifts (driver_id, van_id, status, available, opening_stock)
    values (p_driver_id, p_van_id, 'open', true, p_load)
    returning id into v_shift;

  return v_shift;
end $$;
comment on function delivery.start_shift(uuid, uuid, jsonb) is 'DL-07 EP-DL-001 FR-DL07-003 — atomic hub->van load-out';

-- EP-DL-004 — physical count -> variance -> van->hub return of everything counted.
create function delivery.reconcile_shift(p_shift_id uuid, p_driver_id uuid, p_counted jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, delivery, catalog
as $$
declare
  v_shift delivery.shifts; v_hub uuid; v_van_location uuid;
  v_line jsonb; v_pack uuid; v_counted int; v_expected int; v_variance jsonb := '[]'::jsonb;
begin
  select * into v_shift from delivery.shifts where id = p_shift_id and driver_id = p_driver_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_shift.status <> 'open' then raise exception 'CONFLICT' using errcode = 'P0003'; end if;

  select id into v_hub from catalog.stock_locations where kind = 'hub' and is_active limit 1;
  select id into v_van_location from catalog.stock_locations where van_id = v_shift.van_id;

  for v_line in select * from jsonb_array_elements(p_counted)
  loop
    v_pack := (v_line->>'packSizeId')::uuid;
    v_counted := (v_line->>'qty')::int;
    v_expected := coalesce((select qty from catalog.van_stock where location_id = v_van_location and pack_size_id = v_pack), 0);

    if v_counted > 0 then
      perform catalog.record_stock_movement(v_pack, v_counted, v_van_location, v_hub, 'return', p_driver_id);
    end if;

    if v_counted <> v_expected then
      v_variance := v_variance || jsonb_build_array(jsonb_build_object(
        'packSizeId', v_pack, 'expected', v_expected, 'counted', v_counted, 'delta', v_counted - v_expected));
    end if;
  end loop;

  update delivery.shifts set status = 'reconciling', closing_variance = v_variance where id = p_shift_id;
  return v_variance;
end $$;
comment on function delivery.reconcile_shift(uuid, uuid, jsonb) is 'DL-07 EP-DL-004 FR-DL07-005 — van->hub return + variance snapshot';

-- EP-DL-006 — close only when reconciled with zero variance and custody remitted.
create function delivery.close_shift(p_shift_id uuid, p_driver_id uuid)
returns text
language plpgsql security definer
set search_path = pg_catalog, delivery
as $$
declare v_shift delivery.shifts; v_has_variance boolean;
begin
  select * into v_shift from delivery.shifts where id = p_shift_id and driver_id = p_driver_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_shift.status <> 'reconciling' then raise exception 'CONFLICT' using errcode = 'P0003'; end if;

  select exists (
    select 1 from jsonb_array_elements(coalesce(v_shift.closing_variance, '[]'::jsonb)) e
    where (e->>'delta')::int <> 0
  ) into v_has_variance;
  if v_has_variance then raise exception 'AUDIT_VARIANCE' using errcode = 'P0012'; end if;

  if exists (select 1 from delivery.driver_cash_custody where driver_id = p_driver_id and status = 'held') then
    raise exception 'CUSTODY_OPEN' using errcode = 'P0013';
  end if;

  update delivery.shifts set status = 'closed', ended_at = now() where id = p_shift_id;
  return 'closed';
end $$;
comment on function delivery.close_shift(uuid, uuid) is 'DL-07 EP-DL-006 FR-DL07-005/006';

grant execute on function delivery.start_shift(uuid, uuid, jsonb) to app_user, app_service_role;
grant execute on function delivery.reconcile_shift(uuid, uuid, jsonb) to app_user, app_service_role;
grant execute on function delivery.close_shift(uuid, uuid) to app_user, app_service_role;

-- Down Migration

revoke execute on function delivery.close_shift(uuid, uuid) from app_user, app_service_role;
revoke execute on function delivery.reconcile_shift(uuid, uuid, jsonb) from app_user, app_service_role;
revoke execute on function delivery.start_shift(uuid, uuid, jsonb) from app_user, app_service_role;
drop function if exists delivery.close_shift(uuid, uuid);
drop function if exists delivery.reconcile_shift(uuid, uuid, jsonb);
drop function if exists delivery.start_shift(uuid, uuid, jsonb);
