-- Up Migration
-- DL-05 (POD/COD custody) + DL-08 (unified handover van decrement) + DL-09
-- (exceptions), S12.
alter table delivery.delivery_tasks add column otp_code text;
comment on column delivery.delivery_tasks.otp_code is
  'DL-05 FR-DL05-002 — generated on arrival, plaintext by design (a low-stakes proof-of-presence code read aloud at the door, not an authentication secret; unlike password/verification-token hashes elsewhere in this codebase). Customer reads it via GET /orders/{id} (SF-05) — no SMS vendor is decided (D-15''s vendor list has none), so the customer''s own authenticated order page is the delivery channel.';

-- 'handover' is the one movement kind 0022/0040 never needed until now:
-- goods leave the van (already loaded at shift-start, DL-07) into the
-- recipient's hands at POD time — this is the actual decrement DL-UNI-1
-- means by "per-stop hand-over decrement", not anything at 'picked_up'
-- (which is the driver picking up FROM the van, not from the hub).
alter table catalog.stock_movements drop constraint if exists stock_movements_kind_check;
alter table catalog.stock_movements add constraint stock_movements_kind_check
  check (kind in ('load','return','adjust','handover'));

-- EP-DL-020 sets 'arrived'; the OTP is minted then so it's ready before the
-- driver ever reaches EP-DL-040. Regenerated (not reused) if transition_task
-- is replayed onto an already-arrived task via a different clientActionId —
-- can't happen in practice (idempotency is keyed per clientActionId, and a
-- second distinct action id transitioning FROM 'arrived' would fail the
-- guard anyway since 'arrived' isn't a valid `v_from` for any edge) — this
-- ON CONFLICT-free single UPDATE inside transition_task's existing
-- 'arrived' branch, not a new function.
create or replace function delivery.transition_task(
  p_task_id uuid, p_driver_id uuid, p_to text, p_client_action_id text default null,
  p_lat numeric default null, p_lng numeric default null
) returns delivery_status
language plpgsql security definer
set search_path = pg_catalog, public, delivery, orders, core
as $$
declare v_task delivery.delivery_tasks; v_from delivery_status; v_otp text;
begin
  select * into v_task from delivery.delivery_tasks where id = p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_task.driver_id is distinct from p_driver_id then
    raise exception 'TASK_NOT_ASSIGNED' using errcode = 'P0011';
  end if;

  if p_client_action_id is not null and exists (
    select 1 from delivery.task_events where task_id = p_task_id and client_action_id = p_client_action_id
  ) then
    return v_task.status;
  end if;

  if p_to not in ('at_pickup','picked_up','en_route','arrived') then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;

  v_from := v_task.status;
  if not ( (v_from = 'accepted'  and p_to = 'at_pickup')
        or (v_from = 'at_pickup' and p_to = 'picked_up')
        or (v_from = 'picked_up' and p_to = 'en_route')
        or (v_from = 'en_route'  and p_to = 'arrived') ) then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;

  if p_to = 'arrived' then
    v_otp := lpad(floor(random() * 1000000)::text, 6, '0');
    update delivery.delivery_tasks set status = p_to::delivery_status, otp_code = v_otp where id = p_task_id;
  else
    update delivery.delivery_tasks set status = p_to::delivery_status where id = p_task_id;
  end if;

  insert into delivery.task_events (task_id, from_status, to_status, lat, lng, actor_id, client_action_id)
    values (p_task_id, v_from, p_to::delivery_status, p_lat, p_lng, p_driver_id, p_client_action_id);

  perform orders.mirror_delivery_status(v_task.order_id, p_task_id, p_to);

  insert into core.outbox (name, version, payload)                              -- EV-PC-021
    values ('delivery.task.status_changed', 1,
      jsonb_build_object('task_id', p_task_id, 'order_id', v_task.order_id, 'from', v_from, 'to', p_to, 'at', now(),
                          'location', case when p_lat is not null
                                            then jsonb_build_object('lat', p_lat, 'lng', p_lng) else null end));

  return p_to::delivery_status;
end $$;

-- EP-DL-040 · POD capture. Home/B2B (stop_type <> 'b2c_pickup'): OTP must
-- match, task -> delivered, EV-PC-022, van->nowhere 'handover' decrement per
-- line, COD custody if cod_amount is set. Pickup handover (collector_kind =
-- 'supplier', stop_type = 'b2c_pickup'): no OTP check (the recipient here is
-- the pickup supplier, not the OTP holder — the customer's own collection
-- code is EP-DL-051, S14+ once SP exists), task -> delivered (mirror_
-- delivery_status already skips the order-delivered mirror for pickup_point,
-- 0043), EV-PC-024 instead of EV-PC-022, still decrements van stock (goods
-- physically left the van either way).
create function delivery.capture_pod(
  p_task_id uuid, p_driver_id uuid, p_photo_media_id uuid, p_otp text, p_collector_kind text,
  p_lat numeric default null, p_lng numeric default null, p_cod_collected_amount numeric default null,
  p_client_action_id text default null
) returns text
language plpgsql security definer
set search_path = pg_catalog, delivery, catalog, orders, core
as $$
declare v_task delivery.delivery_tasks; v_van_location uuid; v_line record; v_custody_id uuid;
begin
  select * into v_task from delivery.delivery_tasks where id = p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_task.driver_id is distinct from p_driver_id then
    raise exception 'TASK_NOT_ASSIGNED' using errcode = 'P0011';
  end if;
  if p_client_action_id is not null and exists (
    select 1 from delivery.pods where task_id = p_task_id
  ) then
    return 'delivered'; -- idempotent replay: POD already captured
  end if;
  if v_task.status <> 'arrived' then raise exception 'CONFLICT' using errcode = 'P0003'; end if;
  if p_photo_media_id is null then raise exception 'POD_INCOMPLETE' using errcode = 'P0014'; end if;

  if v_task.stop_type <> 'b2c_pickup' then
    if p_otp is null or p_otp <> v_task.otp_code then
      raise exception 'OTP_MISMATCH' using errcode = 'P0015';
    end if;
  elsif p_collector_kind <> 'supplier' then
    raise exception 'POD_INCOMPLETE' using errcode = 'P0014'; -- pickup tasks must be handed to the supplier
  end if;

  insert into delivery.pods (task_id, photo_media_id, otp_verified, collector_kind, lat, lng)
    values (p_task_id, p_photo_media_id, v_task.stop_type <> 'b2c_pickup', p_collector_kind, p_lat, p_lng);

  update delivery.delivery_tasks set status = 'delivered' where id = p_task_id;
  insert into delivery.task_events (task_id, from_status, to_status, lat, lng, actor_id, client_action_id)
    values (p_task_id, 'arrived', 'delivered', p_lat, p_lng, p_driver_id, p_client_action_id);

  -- DL-UNI-1: van decrement at the actual hand-over point (D-14a mobile-warehouse).
  select id into v_van_location from catalog.stock_locations l
    join delivery.shifts s on s.van_id = l.van_id where s.id = v_task.shift_id;
  if v_van_location is not null then
    for v_line in select pack_size_id, qty from orders.order_lines where order_id = v_task.order_id
    loop
      perform catalog.record_stock_movement(v_line.pack_size_id, v_line.qty, v_van_location, null, 'handover', p_driver_id, v_task.order_id);
    end loop;
  end if;

  perform orders.mirror_delivery_status(v_task.order_id, p_task_id, 'delivered');

  if v_task.stop_type = 'b2c_pickup' then
    insert into core.outbox (name, version, payload)                              -- EV-PC-024
      values ('delivery.order.ready_for_collection', 1,
        jsonb_build_object('task_id', p_task_id, 'order_id', v_task.order_id,
                            'pickup_location_id', v_task.pickup_location_id, 'collection_code_ref', null));
  else
    insert into core.outbox (name, version, payload)                              -- EV-PC-022
      values ('delivery.task.delivered', 1,
        jsonb_build_object('task_id', p_task_id, 'order_id', v_task.order_id, 'pod_id', null, 'delivered_at', now()));
  end if;

  if p_cod_collected_amount is not null and v_task.cod_amount is not null then
    select delivery.record_cash_custody(p_driver_id, v_task.order_id, p_cod_collected_amount) into v_custody_id;  -- EV-PC-026
    insert into orders.payments (order_id, method, amount, status, collected_at)
      values (v_task.order_id, 'cod', p_cod_collected_amount, 'collected', now());
    insert into core.outbox (name, version, actor_sub, payload)                   -- EV-PC-011
      values ('orders.order.paid', 1, null,
        jsonb_build_object('order_id', v_task.order_id, 'method', 'cod', 'amount', p_cod_collected_amount));
  end if;

  return 'delivered';
end $$;
comment on function delivery.capture_pod(uuid, uuid, uuid, text, text, numeric, numeric, numeric, text) is
  'DL-05 EP-DL-040 FR-DL05-001..005/009 — photo+OTP (home/B2B) or supplier handover (pickup)';

-- EP-DL-060 · fail. Order untouched (AC-05 intervention queue, S18 — not
-- built yet, so EV-PC-023 is emitted for a consumer that doesn't exist
-- until then; same "the event is the durable record" reasoning as
-- recall_task). Retry cap [BUSINESS-CONFIRM] not enforced here — no retry
-- mechanism exists yet (re-dispatch of a failed task isn't built; DL-01's
-- dispatch_order only ever fires once per source_event_id).
create function delivery.fail_task(
  p_task_id uuid, p_driver_id uuid, p_reason_code text, p_note text default null, p_client_action_id text default null
) returns delivery_status
language plpgsql security definer
set search_path = pg_catalog, public, delivery, core
as $$
declare v_task delivery.delivery_tasks; v_retry_count int;
begin
  select * into v_task from delivery.delivery_tasks where id = p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_task.driver_id is distinct from p_driver_id then
    raise exception 'TASK_NOT_ASSIGNED' using errcode = 'P0011';
  end if;
  if p_client_action_id is not null and exists (
    select 1 from delivery.task_events where task_id = p_task_id and client_action_id = p_client_action_id
  ) then
    return v_task.status;
  end if;
  if v_task.status not in ('at_pickup','en_route','arrived') then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;

  update delivery.delivery_tasks set status = 'failed' where id = p_task_id;
  insert into delivery.task_events (task_id, from_status, to_status, actor_id, client_action_id)
    values (p_task_id, v_task.status, 'failed', p_driver_id, p_client_action_id);

  select count(*) into v_retry_count from delivery.task_events where task_id = p_task_id and to_status = 'failed';

  insert into core.outbox (name, version, payload)                                -- EV-PC-023
    values ('delivery.task.failed', 1,
      jsonb_build_object('task_id', p_task_id, 'order_id', v_task.order_id, 'reason_code', p_reason_code,
                          'retry_count', v_retry_count, 'note', p_note));

  return 'failed'::delivery_status;
end $$;
comment on function delivery.fail_task(uuid, uuid, text, text, text) is 'DL-09 EP-DL-060 FR-DL09-001/002/003';

-- EP-DL-061 · return undelivered van-carried goods to hub.
create function delivery.return_task_to_hub(p_task_id uuid, p_driver_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, delivery, catalog, orders
as $$
declare v_task delivery.delivery_tasks; v_van_location uuid; v_hub uuid; v_line record;
begin
  select * into v_task from delivery.delivery_tasks where id = p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_task.driver_id is distinct from p_driver_id then
    raise exception 'TASK_NOT_ASSIGNED' using errcode = 'P0011';
  end if;
  if v_task.status <> 'failed' then raise exception 'CONFLICT' using errcode = 'P0003'; end if;

  select id into v_hub from catalog.stock_locations where kind = 'hub' and is_active limit 1;
  select id into v_van_location from catalog.stock_locations l
    join delivery.shifts s on s.van_id = l.van_id where s.id = v_task.shift_id;

  if v_van_location is not null then
    for v_line in select pack_size_id, qty from orders.order_lines where order_id = v_task.order_id
    loop
      perform catalog.record_stock_movement(v_line.pack_size_id, v_line.qty, v_van_location, v_hub, 'return', p_driver_id);
    end loop;
  end if;
end $$;
comment on function delivery.return_task_to_hub(uuid, uuid) is 'DL-09 EP-DL-061 FR-DL09-003 — reconciled against the load-out ledger';

grant execute on function delivery.capture_pod(uuid, uuid, uuid, text, text, numeric, numeric, numeric, text) to app_user, app_service_role;
grant execute on function delivery.fail_task(uuid, uuid, text, text, text) to app_user, app_service_role;
grant execute on function delivery.return_task_to_hub(uuid, uuid) to app_user, app_service_role;

-- Down Migration

revoke execute on function delivery.return_task_to_hub(uuid, uuid) from app_user, app_service_role;
revoke execute on function delivery.fail_task(uuid, uuid, text, text, text) from app_user, app_service_role;
revoke execute on function delivery.capture_pod(uuid, uuid, uuid, text, text, numeric, numeric, numeric, text) from app_user, app_service_role;
drop function if exists delivery.return_task_to_hub(uuid, uuid);
drop function if exists delivery.fail_task(uuid, uuid, text, text, text);
drop function if exists delivery.capture_pod(uuid, uuid, uuid, text, text, numeric, numeric, numeric, text);

create or replace function delivery.transition_task(
  p_task_id uuid, p_driver_id uuid, p_to text, p_client_action_id text default null,
  p_lat numeric default null, p_lng numeric default null
) returns delivery_status
language plpgsql security definer
set search_path = pg_catalog, public, delivery, orders, core
as $$
declare v_task delivery.delivery_tasks; v_from delivery_status;
begin
  select * into v_task from delivery.delivery_tasks where id = p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_task.driver_id is distinct from p_driver_id then
    raise exception 'TASK_NOT_ASSIGNED' using errcode = 'P0011';
  end if;

  if p_client_action_id is not null and exists (
    select 1 from delivery.task_events where task_id = p_task_id and client_action_id = p_client_action_id
  ) then
    return v_task.status;
  end if;

  if p_to not in ('at_pickup','picked_up','en_route','arrived') then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;

  v_from := v_task.status;
  if not ( (v_from = 'accepted'  and p_to = 'at_pickup')
        or (v_from = 'at_pickup' and p_to = 'picked_up')
        or (v_from = 'picked_up' and p_to = 'en_route')
        or (v_from = 'en_route'  and p_to = 'arrived') ) then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;

  update delivery.delivery_tasks set status = p_to::delivery_status where id = p_task_id;
  insert into delivery.task_events (task_id, from_status, to_status, lat, lng, actor_id, client_action_id)
    values (p_task_id, v_from, p_to::delivery_status, p_lat, p_lng, p_driver_id, p_client_action_id);

  perform orders.mirror_delivery_status(v_task.order_id, p_task_id, p_to);

  insert into core.outbox (name, version, payload)
    values ('delivery.task.status_changed', 1,
      jsonb_build_object('task_id', p_task_id, 'order_id', v_task.order_id, 'from', v_from, 'to', p_to, 'at', now(),
                          'location', case when p_lat is not null
                                            then jsonb_build_object('lat', p_lat, 'lng', p_lng) else null end));

  return p_to::delivery_status;
end $$;

alter table catalog.stock_movements drop constraint if exists stock_movements_kind_check;
alter table catalog.stock_movements add constraint stock_movements_kind_check check (kind in ('load','return','adjust'));

alter table delivery.delivery_tasks drop column if exists otp_code;
