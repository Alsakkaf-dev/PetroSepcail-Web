-- Up Migration
-- Two real bugs caught live by custodyJourney.e2e.test.ts (first time
-- delivery.capture_pod has ever executed to completion against a real
-- database - delivery.pods and delivery.driver_cash_custody have zero rows
-- in production, ever), fixed together since both block the same call:
--
-- 1. The van-decrement lookup does `select id from catalog.stock_locations l
--    join delivery.shifts s on s.van_id = l.van_id where s.id =
--    v_task.shift_id` - both tables have an `id` column, so the unqualified
--    `select id` is ambiguous and every real POD capture with a shift-linked
--    task raised "column reference \"id\" is ambiguous" instead of
--    completing. Same class of bug 0031 already fixed once for
--    orders.place_order. Fixed by qualifying it as `l.id` (the stock
--    location's own id is what the code actually needs - it's passed
--    straight into catalog.record_stock_movement's from_location parameter).
--
-- 2. Once past that, the record_stock_movement call itself passed a stray
--    7th argument (v_task.order_id) into p_created_by, a foreign key to
--    core.identities - an order id is never a valid identity id, so every
--    call raised a foreign-key violation. Every other call site of this
--    function in the codebase (start_shift, reconcile_shift,
--    return_task_to_hub) omits this argument and lets it default to null;
--    capture_pod's call is fixed to match.
--
-- Function body is otherwise unchanged from 0049.
create or replace function delivery.capture_pod(
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
  select l.id into v_van_location from catalog.stock_locations l
    join delivery.shifts s on s.van_id = l.van_id where s.id = v_task.shift_id;
  if v_van_location is not null then
    for v_line in select pack_size_id, qty from orders.order_lines where order_id = v_task.order_id
    loop
      -- 0074: dropped the stray 7th argument (v_task.order_id, an order id,
      -- was being passed into p_created_by, which is a foreign key to
      -- core.identities - every other record_stock_movement call site in
      -- this codebase omits it and lets it default to null the same way).
      perform catalog.record_stock_movement(v_line.pack_size_id, v_line.qty, v_van_location, null, 'handover', p_driver_id);
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
  'DL-05 EP-DL-040 FR-DL05-001..005/009 — photo+OTP (home/B2B) or supplier handover (pickup); l.id qualified (0074, was ambiguous)';

-- Down Migration
-- Reverts to 0049's original (ambiguous-column) body, for a clean round-trip.
create or replace function delivery.capture_pod(
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
    return 'delivered';
  end if;
  if v_task.status <> 'arrived' then raise exception 'CONFLICT' using errcode = 'P0003'; end if;
  if p_photo_media_id is null then raise exception 'POD_INCOMPLETE' using errcode = 'P0014'; end if;

  if v_task.stop_type <> 'b2c_pickup' then
    if p_otp is null or p_otp <> v_task.otp_code then
      raise exception 'OTP_MISMATCH' using errcode = 'P0015';
    end if;
  elsif p_collector_kind <> 'supplier' then
    raise exception 'POD_INCOMPLETE' using errcode = 'P0014';
  end if;

  insert into delivery.pods (task_id, photo_media_id, otp_verified, collector_kind, lat, lng)
    values (p_task_id, p_photo_media_id, v_task.stop_type <> 'b2c_pickup', p_collector_kind, p_lat, p_lng);

  update delivery.delivery_tasks set status = 'delivered' where id = p_task_id;
  insert into delivery.task_events (task_id, from_status, to_status, lat, lng, actor_id, client_action_id)
    values (p_task_id, 'arrived', 'delivered', p_lat, p_lng, p_driver_id, p_client_action_id);

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
    insert into core.outbox (name, version, payload)
      values ('delivery.order.ready_for_collection', 1,
        jsonb_build_object('task_id', p_task_id, 'order_id', v_task.order_id,
                            'pickup_location_id', v_task.pickup_location_id, 'collection_code_ref', null));
  else
    insert into core.outbox (name, version, payload)
      values ('delivery.task.delivered', 1,
        jsonb_build_object('task_id', p_task_id, 'order_id', v_task.order_id, 'pod_id', null, 'delivered_at', now()));
  end if;

  if p_cod_collected_amount is not null and v_task.cod_amount is not null then
    select delivery.record_cash_custody(p_driver_id, v_task.order_id, p_cod_collected_amount) into v_custody_id;
    insert into orders.payments (order_id, method, amount, status, collected_at)
      values (v_task.order_id, 'cod', p_cod_collected_amount, 'collected', now());
    insert into core.outbox (name, version, actor_sub, payload)
      values ('orders.order.paid', 1, null,
        jsonb_build_object('order_id', v_task.order_id, 'method', 'cod', 'amount', p_cod_collected_amount));
  end if;

  return 'delivered';
end $$;
comment on function delivery.capture_pod(uuid, uuid, uuid, text, text, numeric, numeric, numeric, text) is
  'DL-05 EP-DL-040 FR-DL05-001..005/009 — photo+OTP (home/B2B) or supplier handover (pickup)';
