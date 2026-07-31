-- Up Migration
-- DL-04 (this session, S10) is the first real caller of
-- orders.mirror_delivery_status (0035, S09 — built with "no caller exists
-- yet in this session's scope"). Wiring it up surfaced two gaps against its
-- own authoritative spec (06-integration-contracts.md §6), fixed here rather
-- than carried forward silently:
--   1. The fixed map is missing `confirmed -> confirmed_received` entirely
--      (only assigned/picked_up/en_route/delivered were handled) — a
--      customer's post-delivery confirmation would have never mirrored.
--   2. No fulfillment_type awareness at all: §6's own D-14 override says a
--      pickup-point task's `delivered` means "handed to the pickup
--      supplier," NOT delivered to the customer, and must NOT map to
--      order_status='delivered' — the real customer-delivered transition
--      for a pickup order is EV-PC-025 (DL-08, S12), not built yet. Without
--      this guard, calling transition_task('arrived'->pickup task reaching
--      whatever a future S12 EP-DL-040 call would produce) on a pickup
--      order would have wrongly closed it out early.
-- `search_path` is set inline (0033/0038's own lesson) and extended to
-- include `delivery` since this function now reads delivery.delivery_tasks
-- (a cross-schema read from a SECURITY DEFINER function — FR-PC03-003).
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
      and o.status in ('ready_for_pickup', 'assigned', 'picked_up', 'en_route', 'delivered'); -- forward-only guard
end $$;
comment on function orders.mirror_delivery_status(uuid, uuid, text) is
  'SF-05/DL-04 FR-SF05-002 — mirrors DL-04 delivery_status onto order_status, with the D-14 pickup-point override (06-integration-contracts §6)';

-- Down Migration

create or replace function orders.mirror_delivery_status(p_order_id uuid, p_task_id uuid, p_to text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_new_status order_status;
begin
  v_new_status := case p_to
    when 'assigned' then 'assigned'
    when 'picked_up' then 'picked_up'
    when 'en_route' then 'en_route'
    when 'delivered' then 'delivered'
    else null
  end;
  if v_new_status is null then
    return;
  end if;

  update orders.orders o set status = v_new_status
    where o.id = p_order_id
      and o.status <> v_new_status
      and o.status in ('ready_for_pickup', 'assigned', 'picked_up', 'en_route');
end $$;
