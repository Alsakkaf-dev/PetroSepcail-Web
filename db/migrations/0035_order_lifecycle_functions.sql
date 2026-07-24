-- Up Migration
-- SF-05 (S09) — D-04 order_status transitions beyond orders.place_order
-- (S08/0031). 0027_orders_rls.sql's own comment already reserves this:
-- "UPDATE (status transitions) is SECURITY DEFINER-only ... future
-- cancel/mirror functions, no broad UPDATE policy granted here" — every
-- function below follows that same shape (security definer, table-qualified
-- column refs throughout per 0031's own fix, `raise exception '<CODE>' using
-- errcode = 'P00xx'` mapped to an ApiError by the calling route, exactly
-- like place_order).

-- FR-SF05-007: customer cancel allowed only strictly before 'preparing'.
create function orders.cancel_order(p_order_id uuid, p_actor uuid, p_reason_code text default 'customer_request')
returns order_status
language plpgsql security definer as $$
declare
  v_updated orders.orders;
begin
  update orders.orders o set status = 'cancelled'
    where o.id = p_order_id and o.user_id = p_actor
      and o.status in ('pending_payment', 'paid', 'confirmed')
    returning o.* into v_updated;

  if not found then
    if not exists (select 1 from orders.orders o where o.id = p_order_id and o.user_id = p_actor) then
      raise exception 'NOT_FOUND' using errcode = 'P0010';
    end if;
    raise exception 'ORDER_NOT_CANCELLABLE' using errcode = 'P0005';
  end if;

  insert into core.outbox (name, version, actor_sub, actor_role, payload)                   -- EV-PC-014
    values ('orders.order.cancelled', 1, p_actor, 'customer',
            jsonb_build_object('order_id', p_order_id, 'reason_code', p_reason_code, 'by_role', 'customer'));

  return v_updated.status;
end $$;
comment on function orders.cancel_order(uuid, uuid, text) is 'SF-05 FR-SF05-007 — customer cancel, only before preparing';
grant execute on function orders.cancel_order(uuid, uuid, text) to app_service_role;

-- FR-SF05-006: delivered -> confirmed_received, idempotent (a repeat call
-- once already confirmed_received is a success no-op, not an error).
create function orders.confirm_receipt(p_order_id uuid, p_actor uuid)
returns order_status
language plpgsql security definer as $$
declare
  v_current order_status;
begin
  select o.status into v_current from orders.orders o where o.id = p_order_id and o.user_id = p_actor;
  if v_current is null then
    raise exception 'NOT_FOUND' using errcode = 'P0010';
  end if;
  if v_current = 'confirmed_received' then
    return v_current; -- idempotent replay
  end if;
  if v_current <> 'delivered' then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;

  update orders.orders o set status = 'confirmed_received' where o.id = p_order_id;
  return 'confirmed_received'::order_status;
end $$;
comment on function orders.confirm_receipt(uuid, uuid) is 'SF-05 FR-SF05-006 — customer confirms delivery receipt, idempotent';
grant execute on function orders.confirm_receipt(uuid, uuid) to app_service_role;

-- FR-SF05-002/06 §6 pickup-override mirror map: DL-04's delivery_status ->
-- this order_status mirror. DL-04 doesn't exist until S10 — built now so
-- that session only has to call it. Idempotent (a duplicate/out-of-order
-- mirror call is silently ignored rather than erroring, since DL-side retry
-- behavior isn't this session's concern to define).
create function orders.mirror_delivery_status(p_order_id uuid, p_task_id uuid, p_to text)
returns void
language plpgsql security definer as $$
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
    return; -- not a status this mirror map defines (e.g. 'accepted'/'at_pickup'/'arrived'/'failed') — no-op
  end if;

  update orders.orders o set status = v_new_status
    where o.id = p_order_id
      and o.status <> v_new_status
      and o.status in ('ready_for_pickup', 'assigned', 'picked_up', 'en_route'); -- forward-only guard
end $$;
comment on function orders.mirror_delivery_status(uuid, uuid, text) is
  'SF-05 FR-SF05-002 — mirrors DL-04 delivery_status onto order_status (06-integration-contracts §6)';
grant execute on function orders.mirror_delivery_status(uuid, uuid, text) to app_service_role;

-- FR-SF05-009: preparing -> ready_for_pickup, emits EV-PC-013 (address_id +
-- cod_amount for DL-01's auto-assign). No caller exists yet in this
-- session's scope (the "warehouse accepts"/"pick complete" admin fulfillment
-- action belongs to AC-05, S18) — built now per FR-SF05-009 so that session
-- only has to call it, same precedent as the mirror function above.
create function orders.mark_ready_for_pickup(p_order_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_order orders.orders;
begin
  update orders.orders o set status = 'ready_for_pickup'
    where o.id = p_order_id and o.status = 'preparing'
    returning o.* into v_order;
  if not found then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;

  insert into core.outbox (name, version, actor_sub, payload)                                -- EV-PC-013
    values ('orders.order.ready_for_pickup', 1, v_order.user_id,
            jsonb_build_object('order_id', p_order_id, 'address_id', v_order.address_snapshot->>'id',
                                'cod_amount', v_order.cod_amount));
end $$;
comment on function orders.mark_ready_for_pickup(uuid) is 'SF-05 FR-SF05-009 — hands order to DL-01 dispatch';
grant execute on function orders.mark_ready_for_pickup(uuid) to app_service_role;

-- Pulled-forward AC-08 stand-in (SPEC-GAP, flagged): the real bank-transfer
-- verification console (receivables, custody, dual-control) is AC-08 / S18.
-- The M2 milestone gate explicitly requires exercising checkout through to
-- "paid/verified", and the ONLY path from pending_payment to paid is an
-- admin verify emitting EV-PC-018 (03-sdd.md §4) — so this session builds
-- the minimal DB-level transition now (pending_payment -> paid -> confirmed,
-- bank-transfer's "paid --auto--> confirmed" edge), the same
-- "pulled-forward, next session replaces it with the full console" pattern
-- already used twice in this codebase (routes/orders.ts, routes/addresses.ts).
create function orders.verify_bank_transfer(p_order_id uuid, p_verified_by uuid)
returns order_status
language plpgsql security definer as $$
declare
  v_order orders.orders;
  v_payment orders.payments;
begin
  select o.* into v_order from orders.orders o where o.id = p_order_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0010';
  end if;
  if v_order.status <> 'pending_payment' then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;

  select p.* into v_payment from orders.payments p
    where p.order_id = p_order_id and p.method = 'bank_transfer' and p.status = 'pending'
    order by p.created_at desc limit 1;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0010';
  end if;

  update orders.payments p set status = 'verified', verified_by = p_verified_by, verified_at = now()
    where p.id = v_payment.id;
  update orders.orders o set status = 'confirmed' where o.id = p_order_id;

  insert into core.outbox (name, version, actor_sub, payload)                                -- EV-PC-018
    values ('payments.bank_transfer.verified', 1, p_verified_by,
            jsonb_build_object('order_id_or_invoice_id', p_order_id, 'verified_amount', v_payment.amount,
                                'verified_by', p_verified_by, 'matched_bank_ref', v_payment.bank_ref));
  insert into core.outbox (name, version, actor_sub, payload)                                -- EV-PC-011
    values ('orders.order.paid', 1, v_order.user_id,
            jsonb_build_object('order_id', p_order_id, 'method', 'bank_transfer', 'amount', v_payment.amount));
  insert into core.outbox (name, version, actor_sub, payload)                                -- EV-PC-012
    values ('orders.order.confirmed', 1, v_order.user_id,
            jsonb_build_object('order_id', p_order_id, 'kind', v_order.kind));

  return 'confirmed'::order_status;
end $$;
comment on function orders.verify_bank_transfer(uuid, uuid) is
  'SF-05/AC-08 stand-in (SPEC-GAP) — pending_payment -> paid -> confirmed; real console is S18';
grant execute on function orders.verify_bank_transfer(uuid, uuid) to app_service_role;

-- Down Migration

drop function if exists orders.verify_bank_transfer(uuid, uuid);
drop function if exists orders.mark_ready_for_pickup(uuid);
drop function if exists orders.mirror_delivery_status(uuid, uuid, text);
drop function if exists orders.confirm_receipt(uuid, uuid);
drop function if exists orders.cancel_order(uuid, uuid, text);
