-- Up Migration
-- EP-DL-041 (OTP regenerate, DL-05) + EP-DL-071 (audit count/close, DL-06),
-- S12.
alter table delivery.delivery_tasks add column otp_regenerated_count int not null default 0;

create function delivery.regenerate_otp(p_task_id uuid, p_driver_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, delivery
as $$
declare v_task delivery.delivery_tasks;
begin
  select * into v_task from delivery.delivery_tasks where id = p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_task.driver_id is distinct from p_driver_id then
    raise exception 'TASK_NOT_ASSIGNED' using errcode = 'P0011';
  end if;
  if v_task.status <> 'arrived' then raise exception 'CONFLICT' using errcode = 'P0003'; end if;
  if v_task.otp_regenerated_count >= 3 then raise exception 'CONFLICT' using errcode = 'P0003'; end if; -- FR-DL05-008 cap

  update delivery.delivery_tasks
    set otp_code = lpad(floor(random() * 1000000)::text, 6, '0'),
        otp_regenerated_count = otp_regenerated_count + 1
    where id = p_task_id;
  -- Re-delivery "via PC-06" (FR-DL05-008) has no channel to send over yet
  -- (same no-SMS-vendor reasoning as the original OTP mint, 0049) — the
  -- customer's own GET /orders/{id} always reflects the current code, so a
  -- regenerate is visible there immediately without a push notification.
end $$;
comment on function delivery.regenerate_otp(uuid, uuid) is 'DL-05 EP-DL-041 FR-DL05-008 — max 3 regenerations per task';
grant execute on function delivery.regenerate_otp(uuid, uuid) to app_user, app_service_role;

-- EP-DL-071 · driver counts a due audit; over-tolerance -> exception + DL-09.
-- Tolerance: 0 units (any variance is over-tolerance) — no tolerance value
-- is specified anywhere in platform-docs (not in 03-sdd.md, not a
-- core.settings key), so a nonzero placeholder would be an invented business
-- rule (D-17: pick the conservative default, don't guess a number nobody
-- wrote down). This mirrors close_shift's own "zero variance" choice (0047).
create function delivery.close_audit(p_audit_id uuid, p_counted jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, delivery, catalog
as $$
declare
  v_audit delivery.stock_audits; v_location_id uuid;
  v_line jsonb; v_pack uuid; v_counted int; v_expected int; v_variance jsonb := '[]'::jsonb; v_over_tolerance boolean := false;
begin
  select * into v_audit from delivery.stock_audits where id = p_audit_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_audit.status <> 'open' then raise exception 'CONFLICT' using errcode = 'P0003'; end if;

  if v_audit.entity_kind = 'driver' then
    select l.id into v_location_id from catalog.stock_locations l
      join delivery.shifts s on s.van_id = l.van_id
      where s.driver_id = v_audit.entity_id and s.status <> 'closed'
      order by s.started_at desc limit 1;
  end if;
  -- entity_kind = 'supplier' has no stock location to compare against yet
  -- (SP-01/S14 doesn't exist) — variance is recorded as "all counted, no
  -- expected baseline" (expected=0) rather than blocked outright, since the
  -- audit itself (raised by the due-worker below) is real regardless.

  for v_line in select * from jsonb_array_elements(p_counted)
  loop
    v_pack := (v_line->>'packSizeId')::uuid;
    v_counted := (v_line->>'qty')::int;
    v_expected := case when v_location_id is not null
      then coalesce((select qty from catalog.van_stock where location_id = v_location_id and pack_size_id = v_pack), 0)
      else 0 end;
    if v_counted <> v_expected then
      v_over_tolerance := true;
      v_variance := v_variance || jsonb_build_array(jsonb_build_object(
        'packSizeId', v_pack, 'expected', v_expected, 'counted', v_counted, 'delta', v_counted - v_expected));
    end if;
  end loop;

  update delivery.stock_audits
    set status = case when v_over_tolerance then 'exception' else 'closed' end,
        variance = v_variance, closed_at = now()
    where id = p_audit_id;

  insert into core.outbox (name, version, payload)                                -- EV-PC-028
    values ('inventory.stock.audited', 1,
      jsonb_build_object('audit_id', p_audit_id, 'entity_kind', v_audit.entity_kind, 'entity_id', v_audit.entity_id,
                          'variance', v_variance, 'over_tolerance', v_over_tolerance));

  return jsonb_build_object('variance', v_variance, 'status', case when v_over_tolerance then 'exception' else 'closed' end);
end $$;
comment on function delivery.close_audit(uuid, jsonb) is 'DL-06 EP-DL-071 FR-DL06-005 — zero-tolerance close; over -> exception + EV-PC-028';
grant execute on function delivery.close_audit(uuid, jsonb) to app_user, app_service_role;

-- Down Migration

revoke execute on function delivery.close_audit(uuid, jsonb) from app_user, app_service_role;
drop function if exists delivery.close_audit(uuid, jsonb);
revoke execute on function delivery.regenerate_otp(uuid, uuid) from app_user, app_service_role;
drop function if exists delivery.regenerate_otp(uuid, uuid);
alter table delivery.delivery_tasks drop column if exists otp_regenerated_count;
