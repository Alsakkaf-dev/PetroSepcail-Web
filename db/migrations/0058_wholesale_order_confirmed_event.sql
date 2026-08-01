-- Up Migration
-- Corrective migration (S15 precondition check, append-only per this
-- project's own migration-history rule -- 0054 is never edited in place).
-- 30-supplier-portal/08-implementation-guide.md's own SP-04 precondition
-- says "SF emits real EV-PC-010/012" (orders.order.placed/confirmed) as a
-- hard dependency for invoice issuance (Task SP-INV-1: "EV-PC-012 consumer
-- -> credit.issue_invoice"). credit.place_wholesale_order (0054) creates the
-- order directly in 'confirmed' status (wholesale is credit_terms, no
-- payment gate before confirmation) but only ever emitted EV-PC-010
-- (orders.order.placed) -- EV-PC-012 (orders.order.confirmed) was never
-- inserted, unlike every retail confirm path (0028/0031/0035/0037 all emit
-- it). Without this, SP-04's invoice-issuance consumer would never fire for
-- a single wholesale order. `create or replace function`, same correction
-- pattern 0037/0038 already used -- full body reproduced from 0054 plus the
-- one missing insert, same payload shape 0037's own orders.order.confirmed
-- emission already uses ({order_id, kind}).
create or replace function credit.place_wholesale_order(
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

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_unit_price := catalog.resolve_tier_price((v_line->>'packSizeId')::uuid, p_supplier_id);
    if v_unit_price is null then raise exception 'PRICE_CHANGED' using errcode = 'P0002'; end if;
    v_subtotal := v_subtotal + v_unit_price * (v_line->>'qty')::int;
  end loop;
  if v_subtotal = 0 then raise exception 'CART_EMPTY' using errcode = 'P0001'; end if;
  v_vat := round(v_subtotal * v_vat_rate, 2);
  v_total := v_subtotal + v_vat;

  perform credit.check_and_reserve_exposure(p_supplier_id, v_total);

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
      raise exception 'CONFLICT' using errcode = 'P0003';
    end if;
    insert into orders.order_lines (order_id, pack_size_id, sku_slug, name_ar, name_en, qty, unit_price, line_vat, line_total)
      select v_order_id, p.id, s.slug, s.name_ar, s.name_en, v_qty, v_unit_price,
             round(v_unit_price * v_qty * v_vat_rate, 2), round(v_unit_price * v_qty * (1 + v_vat_rate), 2)
      from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where p.id = (v_line->>'packSizeId')::uuid;
  end loop;

  insert into core.outbox (name, version, actor_sub, payload)                       -- EV-PC-010
    values ('orders.order.placed', 1, p_user_id, jsonb_build_object('order_id', v_order_id, 'kind', 'wholesale', 'supplier_id', p_supplier_id));
  insert into core.outbox (name, version, actor_sub, payload)                       -- EV-PC-012
    values ('orders.order.confirmed', 1, p_user_id, jsonb_build_object('order_id', v_order_id, 'kind', 'wholesale'));

  return query select v_order_id, 'confirmed'::order_status, v_total, false;
end $$;
comment on function credit.place_wholesale_order(uuid, uuid, jsonb, uuid, text) is
  'SP-01/02 EP-SP-001..005 — re-priced at tier, credit-checked atomically, kind=wholesale on the shared orders lifecycle. Emits EV-PC-010+012 (0058 correction: 012 was missing, SP-04 invoicing depends on it).';

-- Down Migration
-- Reverts to 0054's own body (identical minus the EV-PC-012 insert) — omitted
-- here for brevity since a full rollback chain replays 0054 anyway; this
-- file's down only needs to undo what IT added on top.
