-- Up Migration
-- DL-01 (dispatch/assignment, 03-sdd.md §3) + DL-04 (state machine, §2).
-- Every function is SECURITY DEFINER (FR-PC03-003: cross-schema effects only
-- this way) with `search_path` set inline at creation (0033/0038's own
-- lesson: a later bare CREATE OR REPLACE silently drops hardening applied
-- only via a separate ALTER FUNCTION).
--
-- SCOPED SIMPLIFICATIONS (documented, not silent — D-17 style; both are
-- explicitly deferred to DL-02/DL-M3-0, S11, which wires Google Maps and is
-- the first session with any driver position data to rank or gate on):
--   1. Eligibility "radius" gate (03-sdd.md §3: "driver position within
--      delivery_radius_km") is not enforced — no driver position exists
--      before Maps lands; every open+available+in-stock driver is treated
--      as in-radius. Single-hub Jeddah model makes this a safe default.
--   2. Ranking's "distance" key (lexicographic rule #1) is not computed for
--      the same reason — ranking here runs on keys #2-4 (active task count,
--      rating, driver_id) only, still fully deterministic per NFR-DL-003.
-- Every order in this build is treated as van-fulfilled (D-14a: "each
-- driver/van is a mobile stock sub-ledger") — there is no separate
-- "pre-picked hub parcel" flag anywhere in the schema, so the stock gate
-- always applies; 03-sdd.md's "pre-picked hub parcels skip the stock gate"
-- carve-out has no code path to attach to yet.

create function delivery.find_eligible_driver(p_order_id uuid, p_exclude uuid[] default '{}')
returns uuid
language plpgsql security definer
set search_path = pg_catalog, delivery, catalog, orders
as $$
declare v_driver uuid;
begin
  select d.id into v_driver
  from delivery.drivers d
  join delivery.shifts s on s.driver_id = d.id and s.status = 'open' and s.available
  join catalog.stock_locations l on l.van_id = s.van_id
  where d.status = 'active'
    and not (d.id = any(p_exclude))
    and not exists (
      select 1 from orders.order_lines ol
      where ol.order_id = p_order_id
        and ol.qty > coalesce(
          (select vs.qty from catalog.van_stock vs where vs.location_id = l.id and vs.pack_size_id = ol.pack_size_id),
          0)
    )
  order by
    (select count(*) from delivery.delivery_tasks t
       where t.driver_id = d.id and t.status not in ('delivered','confirmed','failed')) asc,  -- rank #2: least loaded
    d.rating desc,                                                                              -- rank #3: best rated
    d.id asc                                                                                    -- rank #4: deterministic tie-break
  limit 1;

  return v_driver;
end $$;
comment on function delivery.find_eligible_driver(uuid, uuid[]) is
  'DL-01 FR-DL01-002/003 — eligibility gate + lexicographic ranking (distance/radius keys deferred to S11, see migration header)';

-- FR-DL01-001 — idempotent on source_event_id (the EV-PC-013 event_id).
create function delivery.dispatch_order(p_order_id uuid, p_source_event_id uuid)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, delivery, catalog, orders, core
as $$
declare
  v_task delivery.delivery_tasks;
  v_order orders.orders;
  v_stop_type text;
  v_address_id uuid;
  v_driver uuid;
  v_shift uuid;
begin
  select * into v_task from delivery.delivery_tasks where source_event_id = p_source_event_id;
  if found then return v_task.id; end if;

  select * into v_order from orders.orders where id = p_order_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;

  v_stop_type := case
    when v_order.kind = 'wholesale' then 'b2b_drop'
    when v_order.fulfillment_type = 'pickup_point' then 'b2c_pickup'
    else 'b2c_home'
  end;
  v_address_id := case when v_order.fulfillment_type = 'home_delivery'
                        then (v_order.address_snapshot->>'id')::uuid else null end;

  insert into delivery.delivery_tasks
    (order_id, order_kind, fulfillment_type, stop_type, address_id, pickup_location_id, cod_amount, source_event_id, status)
  values
    (p_order_id, v_order.kind, v_order.fulfillment_type, v_stop_type, v_address_id, v_order.pickup_location_id,
     v_order.cod_amount, p_source_event_id, 'assigned')
  returning * into v_task;

  v_driver := delivery.find_eligible_driver(p_order_id, '{}');

  if v_driver is not null then
    select s.id into v_shift from delivery.shifts s where s.driver_id = v_driver and s.status = 'open';
    update delivery.delivery_tasks set driver_id = v_driver, shift_id = v_shift, assigned_at = now() where id = v_task.id;

    insert into core.outbox (name, version, payload)                          -- EV-PC-020
      values ('delivery.task.assigned', 1,
        jsonb_build_object('task_id', v_task.id, 'order_id', p_order_id, 'driver_id', v_driver, 'eta', null));
  end if;
  -- none eligible: task stays status='assigned', driver_id null (03-sdd.md
  -- §3: "task.status stays 'assigned' unassigned + admin alert (AC-09)").
  -- The AC-09 alert surface doesn't exist until S12/S17; the state itself is
  -- correct and queryable (`driver_id is null`) so nothing is silently lost.

  return v_task.id;
end $$;
comment on function delivery.dispatch_order(uuid, uuid) is
  'DL-01 FR-DL01-001 — creates + auto-assigns a delivery task from EV-PC-013, idempotent on source_event_id';

-- EP-DL-011 — assigned -> accepted, only the assigned driver.
create function delivery.accept_task(p_task_id uuid, p_driver_id uuid)
returns delivery_status
language plpgsql security definer
set search_path = pg_catalog, public, delivery, core
as $$
declare v_task delivery.delivery_tasks;
begin
  select * into v_task from delivery.delivery_tasks where id = p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_task.driver_id is distinct from p_driver_id then
    raise exception 'TASK_NOT_ASSIGNED' using errcode = 'P0011';
  end if;
  if v_task.status = 'accepted' then return v_task.status; end if;  -- idempotent replay
  if v_task.status <> 'assigned' then raise exception 'CONFLICT' using errcode = 'P0003'; end if;

  update delivery.delivery_tasks set status = 'accepted' where id = p_task_id;
  insert into delivery.task_events (task_id, from_status, to_status, actor_id)
    values (p_task_id, v_task.status, 'accepted', p_driver_id);
  insert into core.outbox (name, version, payload)                             -- EV-PC-021
    values ('delivery.task.status_changed', 1,
      jsonb_build_object('task_id', p_task_id, 'order_id', v_task.order_id, 'from', v_task.status, 'to', 'accepted', 'at', now()));
  return 'accepted'::delivery_status;
end $$;
comment on function delivery.accept_task(uuid, uuid) is 'DL-01 EP-DL-011 FR-DL01-006';

-- EP-DL-012 — returns the task to re-assignment, excluding the declining driver.
create function delivery.decline_task(p_task_id uuid, p_driver_id uuid)
returns delivery_status
language plpgsql security definer
set search_path = pg_catalog, public, delivery, catalog, orders, core
as $$
declare v_task delivery.delivery_tasks; v_new_driver uuid; v_shift uuid;
begin
  select * into v_task from delivery.delivery_tasks where id = p_task_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_task.driver_id is distinct from p_driver_id then
    raise exception 'TASK_NOT_ASSIGNED' using errcode = 'P0011';
  end if;
  if v_task.status <> 'assigned' then raise exception 'CONFLICT' using errcode = 'P0003'; end if;

  v_new_driver := delivery.find_eligible_driver(v_task.order_id, array[p_driver_id]);
  if v_new_driver is not null then
    select s.id into v_shift from delivery.shifts s where s.driver_id = v_new_driver and s.status = 'open';
  end if;

  update delivery.delivery_tasks
    set driver_id = v_new_driver, shift_id = v_shift,
        assigned_at = case when v_new_driver is not null then now() else null end
    where id = p_task_id;

  insert into delivery.task_events (task_id, from_status, to_status, actor_id)   -- lateral (assigned->assigned); audit trail of the decline
    values (p_task_id, 'assigned', 'assigned', p_driver_id);

  if v_new_driver is not null then
    insert into core.outbox (name, version, payload)                            -- EV-PC-020 (re-assignment)
      values ('delivery.task.assigned', 1,
        jsonb_build_object('task_id', p_task_id, 'order_id', v_task.order_id, 'driver_id', v_new_driver, 'eta', null));
  end if;

  return 'assigned'::delivery_status;
end $$;
comment on function delivery.decline_task(uuid, uuid) is 'DL-01 EP-DL-012 FR-DL01-006';

-- EP-DL-020 — the 4 driver-initiated transitions this session builds
-- (accepted->at_pickup->picked_up->en_route->arrived). 'delivered' requires
-- POD (EP-DL-040, DL-05/S12) and 'failed' is its own endpoint (EP-DL-060,
-- DL-09/S12) — neither is a valid `to` here, matching the API spec's own
-- body type exactly.
create function delivery.transition_task(
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
    return v_task.status; -- idempotent offline replay (NFR-DL-002)
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

  insert into core.outbox (name, version, payload)                              -- EV-PC-021
    values ('delivery.task.status_changed', 1,
      jsonb_build_object('task_id', p_task_id, 'order_id', v_task.order_id, 'from', v_from, 'to', p_to, 'at', now(),
                          'location', case when p_lat is not null
                                            then jsonb_build_object('lat', p_lat, 'lng', p_lng) else null end));

  return p_to::delivery_status;
end $$;
comment on function delivery.transition_task(uuid, uuid, text, text, numeric, numeric) is
  'DL-04 EP-DL-020 FR-DL04-001/002/008 — D-04 guarded transitions, idempotent on clientActionId';

-- Consumes EV-PC-014 (orders.order.cancelled) — unassigns any not-yet-
-- terminal task so it drops off the driver's manifest. No delivery_status
-- value exists for "cancelled" (D-04 has none, and the D-14 no-new-enum-
-- value guard used elsewhere applies the same logic here) and no EV-PC event
-- is registered for a "recalled" fact in 06-integration-contracts — EV-PC-014
-- itself is the durable record. This returns the task to the same
-- "assigned, unassigned" resting state dispatch_order uses when nobody was
-- eligible, so a future re-dispatch (not built this session — nothing
-- currently re-triggers a recalled task) would pick it up normally.
create function delivery.recall_task(p_order_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, delivery
as $$
begin
  update delivery.delivery_tasks
    set driver_id = null, shift_id = null, assigned_at = null
    where order_id = p_order_id and status not in ('delivered','confirmed','failed');
end $$;
comment on function delivery.recall_task(uuid) is 'DL-01 FR-DL01 recall — consumes EV-PC-014 (orders.order.cancelled)';

grant execute on function delivery.find_eligible_driver(uuid, uuid[]) to app_service_role;
grant execute on function delivery.dispatch_order(uuid, uuid) to app_service_role;
grant execute on function delivery.recall_task(uuid) to app_service_role;
grant execute on function delivery.accept_task(uuid, uuid) to app_user, app_service_role;
grant execute on function delivery.decline_task(uuid, uuid) to app_user, app_service_role;
grant execute on function delivery.transition_task(uuid, uuid, text, text, numeric, numeric) to app_user, app_service_role;

-- 06-database-design.md §6 — aggregates only, no PII (AC-09/DL-06 surface).
create view delivery.v_driver_kpis as
select d.id as driver_id,
       coalesce(avg(case when t.status = 'delivered' then 1 else 0 end)::numeric(5,2), 0) as delivered_ratio,
       count(*) filter (where t.status = 'failed') as failed_count
from delivery.drivers d left join delivery.delivery_tasks t on t.driver_id = d.id
group by d.id;
comment on view delivery.v_driver_kpis is 'DL-06/AC-09 — aggregates only, no PII (04-roles §4.1 k-anonymity floor)';

-- Down Migration

drop view if exists delivery.v_driver_kpis;

revoke execute on function delivery.transition_task(uuid, uuid, text, text, numeric, numeric) from app_user, app_service_role;
revoke execute on function delivery.decline_task(uuid, uuid) from app_user, app_service_role;
revoke execute on function delivery.accept_task(uuid, uuid) from app_user, app_service_role;
revoke execute on function delivery.recall_task(uuid) from app_service_role;
revoke execute on function delivery.dispatch_order(uuid, uuid) from app_service_role;
revoke execute on function delivery.find_eligible_driver(uuid, uuid[]) from app_service_role;

drop function if exists delivery.recall_task(uuid);
drop function if exists delivery.transition_task(uuid, uuid, text, text, numeric, numeric);
drop function if exists delivery.decline_task(uuid, uuid);
drop function if exists delivery.accept_task(uuid, uuid);
drop function if exists delivery.dispatch_order(uuid, uuid);
drop function if exists delivery.find_eligible_driver(uuid, uuid[]);
