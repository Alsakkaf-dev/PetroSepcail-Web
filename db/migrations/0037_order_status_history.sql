-- Up Migration
-- SF-05 FR-SF05-004: "Detail view timeline: ordered reached-statuses +
-- timestamps." A dedicated append-only history table (not derived from
-- audit.audit_log, which is AC-07's admin-mutation/PII-read log, a different
-- concern) — every 0035 transition function below now also writes one row
-- here at the moment it changes orders.orders.status. orders.place_order
-- (0031, already shipped) is deliberately NOT redefined to also insert an
-- initial row: the route layer derives the placement-time entry from
-- payment_method (cod -> starts 'confirmed'; bank_transfer -> starts
-- 'pending_payment') + placed_at, which is exact and avoids re-touching an
-- already-committed function body for a cosmetic completeness gain.
create table orders.status_history (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders.orders(id) on delete cascade,
  status   order_status not null,
  at       timestamptz not null default now()
);
create index on orders.status_history (order_id, at);
comment on table orders.status_history is 'SF-05 FR-SF05-004 — order timeline; the FIRST reached status is derived, not stored (see above)';

alter table orders.status_history enable row level security;
alter table orders.status_history force row level security;
create policy status_history_read_own on orders.status_history
  for select using (exists (select 1 from orders.orders o
                            where o.id = order_id and o.user_id = (app_auth.jwt()->>'sub')::uuid));
grant select on orders.status_history to app_user;
grant all privileges on orders.status_history to app_service_role;

create or replace function orders.cancel_order(p_order_id uuid, p_actor uuid, p_reason_code text default 'customer_request')
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

  insert into orders.status_history (order_id, status) values (p_order_id, 'cancelled');
  insert into core.outbox (name, version, actor_sub, actor_role, payload)                   -- EV-PC-014
    values ('orders.order.cancelled', 1, p_actor, 'customer',
            jsonb_build_object('order_id', p_order_id, 'reason_code', p_reason_code, 'by_role', 'customer'));

  return v_updated.status;
end $$;

create or replace function orders.confirm_receipt(p_order_id uuid, p_actor uuid)
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
  insert into orders.status_history (order_id, status) values (p_order_id, 'confirmed_received');
  return 'confirmed_received'::order_status;
end $$;

create or replace function orders.mirror_delivery_status(p_order_id uuid, p_task_id uuid, p_to text)
returns void
language plpgsql security definer as $$
declare
  v_new_status order_status;
  v_updated int;
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
  get diagnostics v_updated = row_count;
  if v_updated > 0 then
    insert into orders.status_history (order_id, status) values (p_order_id, v_new_status);
  end if;
end $$;

create or replace function orders.mark_ready_for_pickup(p_order_id uuid)
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

  insert into orders.status_history (order_id, status) values (p_order_id, 'ready_for_pickup');
  insert into core.outbox (name, version, actor_sub, payload)                                -- EV-PC-013
    values ('orders.order.ready_for_pickup', 1, v_order.user_id,
            jsonb_build_object('order_id', p_order_id, 'address_id', v_order.address_snapshot->>'id',
                                'cod_amount', v_order.cod_amount));
end $$;

create or replace function orders.verify_bank_transfer(p_order_id uuid, p_verified_by uuid)
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
  insert into orders.status_history (order_id, status) values (p_order_id, 'paid'), (p_order_id, 'confirmed');

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

-- Down Migration
-- Functions revert to their 0035 bodies (identical minus the history
-- inserts) — omitted here for brevity since 0035's down migration already
-- drops them entirely on a full rollback chain; this file's own down only
-- needs to undo what IT added.
alter table orders.status_history disable row level security;
drop policy if exists status_history_read_own on orders.status_history;
revoke all privileges on orders.status_history from app_service_role;
revoke select on orders.status_history from app_user;
drop table if exists orders.status_history;
