-- Up Migration
-- DL-01/04's driver manifest + task-detail endpoints (EP-DL-010/013) need to
-- show the recipient's address, but core.addresses (0006_rls_policies.sql)
-- only ever granted an owner-only policy (`addr_own`) — no driver could see
-- any address at all until now, which would have made the manifest endpoint
-- this session builds silently return nothing. 04-roles-and-permissions-
-- matrix.md §3 "customer_pii: driver read — recipient contact fields only,
-- while task active" is exactly this case: scoped to rows that are the
-- address of one of the driver's own currently-active tasks, matching the
-- same `status not in ('delivered','confirmed','failed')` "active" set
-- delivery.delivery_tasks' own partial index already uses.
create policy addr_driver_active_task on core.addresses for select using (
  exists (
    select 1 from delivery.delivery_tasks t
    where t.address_id = addresses.id
      and t.driver_id = (app_auth.jwt()->>'driver_id')::uuid
      and t.status not in ('delivered','confirmed','failed')
  )
);

-- orders.order_lines carries price columns (unit_price/line_vat/line_total)
-- that must NEVER reach a driver (04-roles §3: "driver sees address+lines
-- but NOT price"; delivery.delivery_tasks' own comment repeats this). RLS is
-- row-level, not column-level, so a permissive policy on the base table
-- (like addr_driver_active_task above) would leak price alongside qty/name —
-- a SECURITY DEFINER function that SELECTs only the safe columns is the
-- correct mechanism instead, same idiom this codebase already uses for
-- every other controlled cross-owner read (catalog.record_stock_movement,
-- orders.mirror_delivery_status, ...). No RLS grant on order_lines to
-- app_user is added for drivers — deliberately, so there is no path that
-- could ever leak price.
create function delivery.driver_task_lines(p_task_id uuid, p_driver_id uuid)
returns table (sku_slug text, name_ar text, name_en text, qty int)
language plpgsql security definer
set search_path = pg_catalog, orders, delivery
as $$
begin
  if not exists (select 1 from delivery.delivery_tasks t where t.id = p_task_id and t.driver_id = p_driver_id) then
    return; -- empty result set; the route treats "task exists but not mine" as NOT_FOUND (04-roles §4.4 cross-actor rule)
  end if;
  return query
    select ol.sku_slug, ol.name_ar, ol.name_en, ol.qty
    from delivery.delivery_tasks t join orders.order_lines ol on ol.order_id = t.order_id
    where t.id = p_task_id;
end $$;
comment on function delivery.driver_task_lines(uuid, uuid) is
  'DL-01/04 EP-DL-010/013 — line items for a driver''s own task, columns limited to never include price';
grant execute on function delivery.driver_task_lines(uuid, uuid) to app_user, app_service_role;

-- Down Migration

revoke execute on function delivery.driver_task_lines(uuid, uuid) from app_user, app_service_role;
drop function if exists delivery.driver_task_lines(uuid, uuid);
drop policy if exists addr_driver_active_task on core.addresses;
