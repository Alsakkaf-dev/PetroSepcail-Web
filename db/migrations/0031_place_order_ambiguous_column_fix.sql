-- Up Migration
-- Real bug caught by live e2e verification (S08): orders.place_order's
-- RETURNS TABLE(order_id, status, total, cod_amount, is_replay) clause
-- creates OUT-parameter variables named `status`/`total`/`cod_amount` in
-- scope for the whole function body — every unqualified reference to those
-- column names inside the body (the idempotent-replay lookup, the open-cart
-- check, the final orders.orders insert's own `status` column) became
-- ambiguous against the OUT parameters of the SAME name, failing every
-- checkout call with "column reference is ambiguous". Fix-forward (0028 is
-- already applied elsewhere) with every reference qualified via table
-- aliases; function body is otherwise unchanged.
drop function if exists orders.place_order(uuid, uuid, payment_method, jsonb, text, text, text, uuid, numeric, numeric);

create function orders.place_order(
  p_user uuid, p_cart uuid, p_method payment_method,
  p_address jsonb, p_slot text, p_idem text,
  p_fulfillment_type text default 'home_delivery',
  p_pickup_location_id uuid default null,
  p_delivery_fee numeric default 0,
  p_discount_amount numeric default 0
) returns table(order_id uuid, status order_status, total numeric, cod_amount numeric, is_replay boolean)
language plpgsql security definer as $$
declare
  v_existing record;
  v_vat_rate numeric;
  v_cod_ceiling numeric;
  v_subtotal numeric := 0;
  v_vat numeric := 0;
  v_total numeric;
  v_status order_status;
  v_order_id uuid;
  v_line record;
  v_current_price numeric;
  v_line_vat numeric;
  v_line_total numeric;
  v_lines jsonb := '[]'::jsonb;
  v_line_count int := 0;
begin
  if p_idem is not null then
    select o.id, o.status, o.total, o.cod_amount into v_existing
      from orders.orders o where o.user_id = p_user and o.idempotency_key = p_idem;
    if found then
      return query select v_existing.id, v_existing.status, v_existing.total, v_existing.cod_amount, true;
      return;
    end if;
  end if;

  select (value)::numeric into v_vat_rate from core.settings where key = 'vat_rate';
  select (value)::numeric into v_cod_ceiling from core.settings where key = 'cod_ceiling';

  if not exists (select 1 from orders.carts c where c.id = p_cart and c.user_id = p_user and c.status = 'open') then
    raise exception 'CART_EMPTY' using errcode = 'P0001';
  end if;

  for v_line in
    select cl.pack_size_id, cl.qty, s.slug, s.name_ar, s.name_en
    from orders.cart_lines cl
    join catalog.pack_sizes p on p.id = cl.pack_size_id
    join catalog.skus s on s.id = p.sku_id
    where cl.cart_id = p_cart
  loop
    v_line_count := v_line_count + 1;
    v_current_price := catalog.resolve_retail_price(v_line.pack_size_id);
    if v_current_price is null then
      raise exception 'PRICE_CHANGED' using errcode = 'P0002';
    end if;
    if not catalog.reserve_stock(v_line.pack_size_id, v_line.qty) then
      raise exception 'CONFLICT' using errcode = 'P0003';
    end if;
    v_line_vat := round(v_current_price * v_line.qty * v_vat_rate, 2);
    v_line_total := round(v_current_price * v_line.qty, 2) + v_line_vat;
    v_subtotal := v_subtotal + round(v_current_price * v_line.qty, 2);
    v_vat := v_vat + v_line_vat;
    v_lines := v_lines || jsonb_build_object(
      'pack_size_id', v_line.pack_size_id, 'sku_slug', v_line.slug,
      'name_ar', v_line.name_ar, 'name_en', v_line.name_en,
      'qty', v_line.qty, 'unit_price', v_current_price,
      'line_vat', v_line_vat, 'line_total', v_line_total
    );
  end loop;

  if v_line_count = 0 then
    raise exception 'CART_EMPTY' using errcode = 'P0001';
  end if;

  v_total := v_subtotal + v_vat - p_discount_amount + p_delivery_fee;

  if p_method = 'cod' then
    if v_total > v_cod_ceiling then
      raise exception 'COD_LIMIT_EXCEEDED' using errcode = 'P0004';
    end if;
    v_status := 'confirmed';
  else
    v_status := 'pending_payment';
  end if;

  insert into orders.orders (
    user_id, status, payment_method, fulfillment_type, pickup_location_id,
    subtotal, vat_amount, discount_amount, delivery_fee, total,
    cod_amount, address_snapshot, delivery_slot, idempotency_key
  ) values (
    p_user, v_status, p_method, p_fulfillment_type, p_pickup_location_id,
    v_subtotal, v_vat, p_discount_amount, p_delivery_fee, v_total,
    case when p_method = 'cod' then v_total else null end,
    p_address, p_slot, p_idem
  ) returning id into v_order_id;

  insert into orders.order_lines (order_id, pack_size_id, sku_slug, name_ar, name_en, qty, unit_price, line_vat, line_total)
  select v_order_id, (l->>'pack_size_id')::uuid, l->>'sku_slug', l->>'name_ar', l->>'name_en',
         (l->>'qty')::int, (l->>'unit_price')::numeric, (l->>'line_vat')::numeric, (l->>'line_total')::numeric
  from jsonb_array_elements(v_lines) l;

  update orders.carts set status = 'converted' where id = p_cart;

  insert into core.outbox (name, version, actor_sub, payload)                                -- EV-PC-010
    values ('orders.order.placed', 1, p_user,
            jsonb_build_object('order_id', v_order_id, 'kind', 'retail', 'total', v_total, 'vat', v_vat));

  if p_method = 'cod' then
    insert into core.outbox (name, version, actor_sub, payload)                              -- EV-PC-012
      values ('orders.order.confirmed', 1, p_user,
              jsonb_build_object('order_id', v_order_id, 'cod_amount', v_total));
  end if;

  return query select v_order_id, v_status, v_total,
                      (case when p_method = 'cod' then v_total else null end), false;
end $$;
comment on function orders.place_order(uuid, uuid, payment_method, jsonb, text, text, text, uuid, numeric, numeric) is
  'SF-04 FR-SF04-008/009/010 — atomic, idempotent order placement';

grant execute on function orders.place_order(uuid, uuid, payment_method, jsonb, text, text, text, uuid, numeric, numeric) to service_role;

-- Down Migration
-- Reverts to 0028's original (ambiguous-column) body, matching that
-- migration's own down migration exactly, for a clean round-trip.
drop function if exists orders.place_order(uuid, uuid, payment_method, jsonb, text, text, text, uuid, numeric, numeric);

create function orders.place_order(
  p_user uuid, p_cart uuid, p_method payment_method,
  p_address jsonb, p_slot text, p_idem text,
  p_fulfillment_type text default 'home_delivery',
  p_pickup_location_id uuid default null,
  p_delivery_fee numeric default 0,
  p_discount_amount numeric default 0
) returns table(order_id uuid, status order_status, total numeric, cod_amount numeric, is_replay boolean)
language plpgsql security definer as $$
declare
  v_existing record;
  v_vat_rate numeric;
  v_cod_ceiling numeric;
  v_subtotal numeric := 0;
  v_vat numeric := 0;
  v_total numeric;
  v_status order_status;
  v_order_id uuid;
  v_line record;
  v_current_price numeric;
  v_line_vat numeric;
  v_line_total numeric;
  v_lines jsonb := '[]'::jsonb;
  v_line_count int := 0;
begin
  if p_idem is not null then
    select id, status, total, cod_amount into v_existing
      from orders.orders where user_id = p_user and idempotency_key = p_idem;
    if found then
      return query select v_existing.id, v_existing.status, v_existing.total, v_existing.cod_amount, true;
      return;
    end if;
  end if;
  select (value)::numeric into v_vat_rate from core.settings where key = 'vat_rate';
  select (value)::numeric into v_cod_ceiling from core.settings where key = 'cod_ceiling';
  if not exists (select 1 from orders.carts where id = p_cart and user_id = p_user and status = 'open') then
    raise exception 'CART_EMPTY' using errcode = 'P0001';
  end if;
  for v_line in
    select cl.pack_size_id, cl.qty, s.slug, s.name_ar, s.name_en
    from orders.cart_lines cl
    join catalog.pack_sizes p on p.id = cl.pack_size_id
    join catalog.skus s on s.id = p.sku_id
    where cl.cart_id = p_cart
  loop
    v_line_count := v_line_count + 1;
    v_current_price := catalog.resolve_retail_price(v_line.pack_size_id);
    if v_current_price is null then raise exception 'PRICE_CHANGED' using errcode = 'P0002'; end if;
    if not catalog.reserve_stock(v_line.pack_size_id, v_line.qty) then raise exception 'CONFLICT' using errcode = 'P0003'; end if;
    v_line_vat := round(v_current_price * v_line.qty * v_vat_rate, 2);
    v_line_total := round(v_current_price * v_line.qty, 2) + v_line_vat;
    v_subtotal := v_subtotal + round(v_current_price * v_line.qty, 2);
    v_vat := v_vat + v_line_vat;
    v_lines := v_lines || jsonb_build_object('pack_size_id', v_line.pack_size_id, 'sku_slug', v_line.slug,
      'name_ar', v_line.name_ar, 'name_en', v_line.name_en, 'qty', v_line.qty, 'unit_price', v_current_price,
      'line_vat', v_line_vat, 'line_total', v_line_total);
  end loop;
  if v_line_count = 0 then raise exception 'CART_EMPTY' using errcode = 'P0001'; end if;
  v_total := v_subtotal + v_vat - p_discount_amount + p_delivery_fee;
  if p_method = 'cod' then
    if v_total > v_cod_ceiling then raise exception 'COD_LIMIT_EXCEEDED' using errcode = 'P0004'; end if;
    v_status := 'confirmed';
  else
    v_status := 'pending_payment';
  end if;
  insert into orders.orders (user_id, status, payment_method, fulfillment_type, pickup_location_id,
    subtotal, vat_amount, discount_amount, delivery_fee, total, cod_amount, address_snapshot, delivery_slot, idempotency_key)
  values (p_user, v_status, p_method, p_fulfillment_type, p_pickup_location_id, v_subtotal, v_vat, p_discount_amount,
    p_delivery_fee, v_total, case when p_method = 'cod' then v_total else null end, p_address, p_slot, p_idem)
  returning id into v_order_id;
  insert into orders.order_lines (order_id, pack_size_id, sku_slug, name_ar, name_en, qty, unit_price, line_vat, line_total)
  select v_order_id, (l->>'pack_size_id')::uuid, l->>'sku_slug', l->>'name_ar', l->>'name_en',
         (l->>'qty')::int, (l->>'unit_price')::numeric, (l->>'line_vat')::numeric, (l->>'line_total')::numeric
  from jsonb_array_elements(v_lines) l;
  update orders.carts set status = 'converted' where id = p_cart;
  insert into core.outbox (name, version, actor_sub, payload)
    values ('orders.order.placed', 1, p_user, jsonb_build_object('order_id', v_order_id, 'kind', 'retail', 'total', v_total, 'vat', v_vat));
  if p_method = 'cod' then
    insert into core.outbox (name, version, actor_sub, payload)
      values ('orders.order.confirmed', 1, p_user, jsonb_build_object('order_id', v_order_id, 'cod_amount', v_total));
  end if;
  return query select v_order_id, v_status, v_total, (case when p_method = 'cod' then v_total else null end), false;
end $$;
grant execute on function orders.place_order(uuid, uuid, payment_method, jsonb, text, text, text, uuid, numeric, numeric) to service_role;
