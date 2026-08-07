-- Up Migration
-- Real bug caught live by custodyJourney.e2e.test.ts: orders.mirror_delivery_status's
-- forward-only guard only updates an order whose CURRENT status is one of
-- ('ready_for_pickup', 'assigned', 'picked_up', 'en_route', 'delivered') - but a COD
-- order (and a bank-transfer order once verified) starts at 'confirmed', and nothing
-- in this codebase ever moves an order through 'preparing'/'ready_for_pickup'
-- (orders.mark_ready_for_pickup requires status='preparing', and nothing sets that
-- either - the fulfillment console that would is a documented, out-of-scope
-- SPEC-GAP). delivery.dispatch_order creates the task directly at delivery_status
-- 'assigned' without ever calling this mirror for that step, either.
--
-- Net effect: every mirror call for a real order - 'picked_up', 'en_route',
-- 'delivered' - silently matched zero rows (the WHERE guard excluded 'confirmed',
-- so no error, just no update) and the order's own status stayed 'confirmed'
-- forever, regardless of how far the actual delivery progressed. A customer's own
-- order-tracking page (SF-06) would show "confirmed" even after real delivery and
-- cash becoming custody - this is the exact customer-visible half of the critical
-- delivery journey, and it silently never worked.
--
-- Fix: widen the allowed starting-status set to include the two earlier states
-- that exist in the order_status enum's forward path (D-04) but have no real
-- transition into them yet - 'confirmed' and 'preparing' - so the mirror can
-- actually advance a freshly-confirmed order the same way it already advances
-- one that reached 'ready_for_pickup' by some other path. Still forward-only:
-- terminal/cancelled states (cancelled, refunded, returned, confirmed_received)
-- remain excluded, so a mirror event can never resurrect or regress a closed
-- order. Function body otherwise unchanged from 0043.
create or replace function orders.mirror_delivery_status(p_order_id uuid, p_task_id uuid, p_to text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, orders, delivery
as $$
declare
  v_new_status order_status;
  v_fulfillment_type text;
begin
  select fulfillment_type into v_fulfillment_type from delivery.delivery_tasks where id = p_task_id;

  v_new_status := case
    when p_to = 'delivered' and v_fulfillment_type = 'pickup_point' then null  -- D-14 override: awaiting collection, not delivered (§6)
    when p_to = 'assigned' then 'assigned'
    when p_to = 'picked_up' then 'picked_up'
    when p_to = 'en_route' then 'en_route'
    when p_to = 'delivered' then 'delivered'
    when p_to = 'confirmed' then 'confirmed_received'
    else null
  end;
  if v_new_status is null then
    return; -- not a status this mirror map defines (e.g. 'accepted'/'at_pickup'/'arrived'/'failed'), or the pickup override above
  end if;

  update orders.orders o set status = v_new_status
    where o.id = p_order_id
      and o.status <> v_new_status
      and o.status in ('confirmed', 'preparing', 'ready_for_pickup', 'assigned', 'picked_up', 'en_route', 'delivered'); -- forward-only guard
end $$;
comment on function orders.mirror_delivery_status(uuid, uuid, text) is
  'SF-05/DL-04 FR-SF05-002 — mirrors DL-04 delivery_status onto order_status, with the D-14 pickup-point override (06-integration-contracts §6); 0075 widened the forward-only guard to include confirmed/preparing, the states a real order actually starts a delivery from';

-- Down Migration
-- Reverts to 0043's original (confirmed/preparing-excluded) body, for a clean round-trip.
create or replace function orders.mirror_delivery_status(p_order_id uuid, p_task_id uuid, p_to text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, orders, delivery
as $$
declare
  v_new_status order_status;
  v_fulfillment_type text;
begin
  select fulfillment_type into v_fulfillment_type from delivery.delivery_tasks where id = p_task_id;

  v_new_status := case
    when p_to = 'delivered' and v_fulfillment_type = 'pickup_point' then null
    when p_to = 'assigned' then 'assigned'
    when p_to = 'picked_up' then 'picked_up'
    when p_to = 'en_route' then 'en_route'
    when p_to = 'delivered' then 'delivered'
    when p_to = 'confirmed' then 'confirmed_received'
    else null
  end;
  if v_new_status is null then
    return;
  end if;

  update orders.orders o set status = v_new_status
    where o.id = p_order_id
      and o.status <> v_new_status
      and o.status in ('ready_for_pickup', 'assigned', 'picked_up', 'en_route', 'delivered');
end $$;
comment on function orders.mirror_delivery_status(uuid, uuid, text) is
  'SF-05/DL-04 FR-SF05-002 — mirrors DL-04 delivery_status onto order_status, with the D-14 pickup-point override (06-integration-contracts §6)';
