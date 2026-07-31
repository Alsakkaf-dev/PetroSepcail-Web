-- Up Migration
-- 30-supplier-portal/04-database-design.md §5/§6 (Task SP-DB-3 functions +
-- views) + SP-ORDER-2's own wholesale placement (not named in the doc's own
-- §5 function list — that section covers SP-03/04/05's functions only; SF's
-- orders.place_order (S08) is retail-only, so SP-01 needs its own placement
-- path, same relationship DL-01's dispatch_order has to SF-05's
-- mark_ready_for_pickup). `search_path` set inline throughout (0033/0038's
-- own lesson); every function that touches `invoice_status`/`order_status`
-- gets `public` in its search_path for the same reason 0042/0049 needed it
-- (unqualified enum types live in `public`).

-- FR-SP03-001. Custody deliberately absent (D-14 rule f).
create function credit.compute_exposure(p_supplier uuid) returns numeric
language sql stable
set search_path = pg_catalog, credit, orders
as $$
  select coalesce((select sum(open_balance) from credit.invoices
                   where supplier_id = p_supplier and status in ('issued','partially_paid','overdue')), 0)
       + coalesce((select sum(o.total) from orders.orders o
                   where o.supplier_id = p_supplier and o.kind = 'wholesale'
                     and o.status = 'confirmed'
                     and not exists (select 1 from credit.invoices i where i.order_id = o.id)), 0);
$$;
comment on function credit.compute_exposure(uuid) is 'SP-03 FR-SP03-001 — single exposure source; custody excluded by construction (D-14 rule f)';

-- FR-SP03-002/EP-X-001 — row-locked, concurrency-safe, <=-inclusive boundary.
create function credit.check_and_reserve_exposure(p_supplier uuid, p_order_total numeric)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, credit, core
as $$
declare v_limit numeric; v_exposure numeric;
begin
  select limit_amount into v_limit from credit.credit_limits
    where supplier_id = p_supplier and is_current for update;
  if v_limit is null then raise exception 'NO_CREDIT_LIMIT' using errcode = 'P0020'; end if;
  v_exposure := credit.compute_exposure(p_supplier);
  if v_exposure + p_order_total > v_limit then
    insert into core.outbox (name, version, payload)                                -- EV-PC-035
      values ('credit.limit.exceeded', 1,
              jsonb_build_object('supplier_id', p_supplier, 'exposure', v_exposure,
                                 'limit', v_limit, 'blocked_order_total', p_order_total));
    raise exception 'CREDIT_LIMIT_EXCEEDED' using errcode = 'P0021',
      detail = jsonb_build_object('exposure', v_exposure, 'limit', v_limit,
                                  'shortfall', v_exposure + p_order_total - v_limit)::text;
  end if;
  return jsonb_build_object('approved', true, 'exposure_after', v_exposure + p_order_total);
end $$;
comment on function credit.check_and_reserve_exposure(uuid, numeric) is
  'SP-03 EP-X-001 — THE credit predicate; row-locked (serializes concurrent placements), <=-inclusive';

-- SP-02 FR-SP02 — never exposed to a customer session (NFR-SP-003); SECURITY
-- DEFINER so it may read credit.suppliers.tier (not otherwise app_user-visible
-- cross-supplier, and tier_prices' own RLS already scopes reads anyway — this
-- is the resolver a wholesale cart/checkout calls, not a raw table read).
create function catalog.resolve_tier_price(p_pack uuid, p_supplier uuid)
returns numeric
language sql stable security definer
set search_path = pg_catalog, catalog, credit
as $$
  select tp.unit_price from catalog.tier_prices tp
  where tp.pack_size_id = p_pack
    and tp.tier = (select tier from credit.suppliers where id = p_supplier);
$$;
comment on function catalog.resolve_tier_price(uuid, uuid) is 'SP-02 FR-SP02 — resolves at the caller''s own tier only';

-- Backfills core.role_grants.supplier_id the same way delivery's 0044/0047
-- backfilled driver_id — S09's AC-06 provisioning created the identity +
-- role_grant before credit.suppliers existed to point at.
create function credit.provision_supplier(
  p_identity_id uuid, p_business_name_ar text, p_business_name_en text, p_cr_number text default null, p_vat_number text default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, credit, core
as $$
declare v_supplier_id uuid; v_default_limit numeric;
begin
  insert into credit.suppliers (identity_id, business_name_ar, business_name_en, cr_number, vat_number, status, activated_at)
    values (p_identity_id, p_business_name_ar, p_business_name_en, p_cr_number, p_vat_number, 'active', now())
    returning id into v_supplier_id;

  select (value)::numeric into v_default_limit from core.settings where key = 'default_credit_limit';
  insert into credit.credit_limits (supplier_id, limit_amount, reason) values (v_supplier_id, coalesce(v_default_limit, 20000), 'initial provisioning default');

  update core.role_grants set supplier_id = v_supplier_id where identity_id = p_identity_id and role = 'supplier';

  return v_supplier_id;
end $$;
comment on function credit.provision_supplier(uuid, text, text, text, text) is 'SP-01 EP-SP-010-adjacent — creates supplier master + default credit limit';

-- EP-SP-011 · profile edit — contact/bank ONLY; tier/limit are admin-only
-- (AC-03), enforced here structurally (this function has no tier/limit
-- parameter at all) rather than by a column-grant trick.
create function credit.update_supplier_profile(
  p_supplier_id uuid, p_business_name_ar text default null, p_business_name_en text default null,
  p_bank_name text default null, p_bank_iban text default null
) returns void
language plpgsql security definer
set search_path = pg_catalog, credit
as $$
begin
  update credit.suppliers set
    business_name_ar = coalesce(p_business_name_ar, business_name_ar),
    business_name_en = coalesce(p_business_name_en, business_name_en),
    bank_name = coalesce(p_bank_name, bank_name),
    bank_iban = coalesce(p_bank_iban, bank_iban),
    updated_at = now()
  where id = p_supplier_id;
end $$;
comment on function credit.update_supplier_profile(uuid, text, text, text, text) is 'SP-01 EP-SP-011 FR-SP01 — contact/bank only';

-- SP-ORDER-2: EP-SP-001..005 wholesale placement. Re-prices at the
-- supplier's tier (never trusts a client-supplied price, same discipline as
-- orders.place_order/SF-04), credit-checks atomically inside the same
-- transaction (row lock held for the txn's duration IS what serializes
-- concurrent placements — the doc's own §5 comment on check_and_reserve_
-- exposure), and reuses the SHARED orders.orders/order_lines tables with
-- kind='wholesale' (D-05: "one D-04 lifecycle"). Stock is reserved the same
-- way retail does (catalog.reserve_stock) — D-14a's hub is still the single
-- fulfillment source of truth for wholesale too; wholesale doesn't get its
-- own inventory pool.
create function credit.place_wholesale_order(
  p_supplier_id uuid, p_user_id uuid, p_lines jsonb, p_address_id uuid, p_idempotency_key text default null
) returns table(order_id uuid, status order_status, total numeric, is_replay boolean)
language plpgsql security definer
set search_path = pg_catalog, public, credit, catalog, orders, core
as $$
declare
  v_existing record;
  v_line jsonb; v_unit_price numeric; v_qty int; v_subtotal numeric := 0; v_vat numeric; v_total numeric;
  v_vat_rate numeric; v_order_id uuid; v_address jsonb;
begin
  if p_idempotency_key is not null then
    select o.id, o.status, o.total into v_existing
      from orders.orders o where o.user_id = p_user_id and o.idempotency_key = p_idempotency_key;
    if found then
      return query select v_existing.id, v_existing.status, v_existing.total, true;
      return;
    end if;
  end if;

  select (core.get_setting('vat_rate'))::numeric into v_vat_rate;
  select to_jsonb(a) into v_address from core.addresses a where a.id = p_address_id and a.identity_id = p_user_id;
  if v_address is null then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;

  -- Pass 1: re-price at the supplier's own tier + total, before any write —
  -- credit is checked against the REAL total, never a client-supplied one.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_unit_price := catalog.resolve_tier_price((v_line->>'packSizeId')::uuid, p_supplier_id);
    if v_unit_price is null then raise exception 'PRICE_CHANGED' using errcode = 'P0002'; end if;
    v_subtotal := v_subtotal + v_unit_price * (v_line->>'qty')::int;
  end loop;
  if v_subtotal = 0 then raise exception 'CART_EMPTY' using errcode = 'P0001'; end if;
  v_vat := round(v_subtotal * v_vat_rate, 2);
  v_total := v_subtotal + v_vat;

  perform credit.check_and_reserve_exposure(p_supplier_id, v_total); -- raises CREDIT_LIMIT_EXCEEDED, row-locks credit_limits

  insert into orders.orders (user_id, kind, supplier_id, status, payment_method, fulfillment_type,
                              subtotal, vat_amount, total, address_snapshot, delivery_slot, idempotency_key)
    values (p_user_id, 'wholesale', p_supplier_id, 'confirmed', 'credit_terms', 'home_delivery',
            v_subtotal, v_vat, v_total, v_address, 'next_am', p_idempotency_key)
    returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := (v_line->>'qty')::int;
    v_unit_price := catalog.resolve_tier_price((v_line->>'packSizeId')::uuid, p_supplier_id);
    if not catalog.reserve_stock((v_line->>'packSizeId')::uuid, v_qty) then
      raise exception 'CONFLICT' using errcode = 'P0003'; -- CART_LINE_UNAVAILABLE-equivalent for the wholesale path
    end if;
    insert into orders.order_lines (order_id, pack_size_id, sku_slug, name_ar, name_en, qty, unit_price, line_vat, line_total)
      select v_order_id, p.id, s.slug, s.name_ar, s.name_en, v_qty, v_unit_price,
             round(v_unit_price * v_qty * v_vat_rate, 2), round(v_unit_price * v_qty * (1 + v_vat_rate), 2)
      from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where p.id = (v_line->>'packSizeId')::uuid;
  end loop;

  insert into core.outbox (name, version, actor_sub, payload)                       -- EV-PC-010
    values ('orders.order.placed', 1, p_user_id, jsonb_build_object('order_id', v_order_id, 'kind', 'wholesale', 'supplier_id', p_supplier_id));

  return query select v_order_id, 'confirmed'::order_status, v_total, false;
end $$;
comment on function credit.place_wholesale_order(uuid, uuid, jsonb, uuid, text) is
  'SP-01/02 EP-SP-001..005 — re-priced at tier, credit-checked atomically, kind=wholesale on the shared orders lifecycle';

grant execute on function credit.compute_exposure(uuid) to app_user, app_service_role;
grant execute on function credit.check_and_reserve_exposure(uuid, numeric) to app_service_role;
grant execute on function catalog.resolve_tier_price(uuid, uuid) to app_user, app_service_role;
grant execute on function credit.provision_supplier(uuid, text, text, text, text) to app_service_role;
grant execute on function credit.update_supplier_profile(uuid, text, text, text, text) to app_service_role;
grant execute on function credit.place_wholesale_order(uuid, uuid, jsonb, uuid, text) to app_service_role;

-- SP-DB-3 views (§6).
create view credit.v_exposure as
select s.id as supplier_id, credit.compute_exposure(s.id) as exposure,
       (select limit_amount from credit.credit_limits where supplier_id = s.id and is_current) as credit_limit
from credit.suppliers s;

create view credit.v_receivables_aging as
select supplier_id,
  sum(open_balance) filter (where now()::date - issued_at::date between 0 and 30)  as b_0_30,
  sum(open_balance) filter (where now()::date - issued_at::date between 31 and 60) as b_31_60,
  sum(open_balance) filter (where now()::date - issued_at::date between 61 and 90) as b_61_90,
  sum(open_balance) filter (where now()::date - issued_at::date > 90)              as b_90_plus
from credit.invoices where status in ('issued','partially_paid','overdue')
group by supplier_id;

create view catalog.v_pickup_points as
select id, business_name_ar, business_name_en, geo_lat, geo_lng
from credit.suppliers where is_pickup_point and status = 'active';
comment on view catalog.v_pickup_points is 'FR-SP01-006 — public directory: name + geo ONLY, no PII/debt/custody';
grant select on catalog.v_pickup_points to app_user;

-- Down Migration

revoke select on catalog.v_pickup_points from app_user;
drop view if exists catalog.v_pickup_points;
drop view if exists credit.v_receivables_aging;
drop view if exists credit.v_exposure;

revoke execute on function credit.place_wholesale_order(uuid, uuid, jsonb, uuid, text) from app_service_role;
revoke execute on function credit.update_supplier_profile(uuid, text, text, text, text) from app_service_role;
revoke execute on function credit.provision_supplier(uuid, text, text, text, text) from app_service_role;
revoke execute on function catalog.resolve_tier_price(uuid, uuid) from app_user, app_service_role;
revoke execute on function credit.check_and_reserve_exposure(uuid, numeric) from app_service_role;
revoke execute on function credit.compute_exposure(uuid) from app_user, app_service_role;

drop function if exists credit.place_wholesale_order(uuid, uuid, jsonb, uuid, text);
drop function if exists credit.update_supplier_profile(uuid, text, text, text, text);
drop function if exists credit.provision_supplier(uuid, text, text, text, text);
drop function if exists catalog.resolve_tier_price(uuid, uuid);
drop function if exists credit.check_and_reserve_exposure(uuid, numeric);
drop function if exists credit.compute_exposure(uuid);
