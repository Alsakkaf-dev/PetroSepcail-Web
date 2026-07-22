-- Up Migration
-- 10-customer-storefront/04-database-design.md §5: catalog.reserve_stock/
-- release_stock (verbatim) + orders.place_order (the doc gives only a stub
-- signature — "full body in 08-implementation-guide PC/SF tasks" — this is
-- that implementation, SF-CHK-2/S08).
create function catalog.reserve_stock(p_pack uuid, p_qty int)
returns boolean language plpgsql security definer as $$
declare ok boolean;
begin
  update catalog.inventory
     set reserved = reserved + p_qty, updated_at = now()
   where pack_size_id = p_pack and (qty_on_hand - reserved) >= p_qty
   returning true into ok;                                  -- atomic guard (05-master-db §6)
  return coalesce(ok, false);                               -- false => insufficient stock => caller raises CONFLICT
end $$;
comment on function catalog.reserve_stock(uuid, int) is 'SF-04 — atomic stock hold at checkout';

create function catalog.release_stock(p_pack uuid, p_qty int)
returns void language plpgsql security definer as $$
begin
  update catalog.inventory set reserved = greatest(reserved - p_qty, 0), updated_at = now()
   where pack_size_id = p_pack;
end $$;
comment on function catalog.release_stock(uuid, int) is 'SF-04/SF-05 — releases a reservation (cancel, timeout sweep)';

grant execute on function catalog.reserve_stock(uuid, int) to app_user, service_role;
grant execute on function catalog.release_stock(uuid, int) to app_user, service_role;

-- Down Migration

revoke execute on function catalog.release_stock(uuid, int) from app_user, service_role;
revoke execute on function catalog.reserve_stock(uuid, int) from app_user, service_role;
drop function if exists catalog.release_stock(uuid, int);
drop function if exists catalog.reserve_stock(uuid, int);
