-- Up Migration
-- 10-customer-storefront/04-database-design.md §5: retail price authority
-- ("the value behind EP-X-004 for a customer actor"). Only the piece SF-01's
-- pricing display (EP-SF-004, TC-SF01-013..015) needs this session —
-- catalog.reserve_stock/release_stock and the orders.* functions are SF-04/
-- SF-08 territory (S08/S09), out of S07's scope.
create function catalog.resolve_retail_price(p_pack uuid)
returns numeric language sql stable as $$
  select list_price from catalog.prices where pack_size_id = p_pack and is_current
$$;
comment on function catalog.resolve_retail_price(uuid) is
  'SF-01 — ex-VAT retail list price for a pack size; VAT applied by the caller from core.get_setting(''vat_rate'').';

grant execute on function catalog.resolve_retail_price(uuid) to app_user;

-- Down Migration

revoke execute on function catalog.resolve_retail_price(uuid) from app_user;
drop function if exists catalog.resolve_retail_price(uuid);
