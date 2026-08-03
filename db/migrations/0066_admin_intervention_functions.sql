-- Up Migration
-- 40-admin-center/08-implementation-guide.md §4 (AC-INT-1/AC-05, S18).
-- Every function here validates reason_code against audit.reason_codes
-- (fixed list, 0064) and requires a note when that code's own
-- requires_note flag is set — "free-text-only reasons rejected" (04's own
-- table comment).

create function audit.validate_reason(p_code text, p_note text)
returns void
language plpgsql security definer
set search_path = pg_catalog, audit
as $$
declare v_requires_note boolean;
begin
  select requires_note into v_requires_note from audit.reason_codes where code = p_code and active;
  if not found then raise exception 'INVALID_REASON_CODE' using errcode = 'P0025'; end if;
  if v_requires_note and (p_note is null or length(trim(p_note)) = 0) then
    raise exception 'INVALID_REASON_CODE' using errcode = 'P0025', detail = 'note required for this reason code';
  end if;
end $$;
comment on function audit.validate_reason(text, text) is 'AC-05 — shared reason-code validation every intervention function calls first';
grant execute on function audit.validate_reason(text, text) to app_service_role;

-- EP-AC-041: force-cancel a non-delivered order. Broader than the customer
-- path (orders.cancel_order, 0035, stops at 'confirmed') -- an admin can
-- force-cancel through any pre-delivered status; 'delivered'/
-- 'confirmed_received' are the only terminal blocks (a physically completed
-- handoff cannot be un-cancelled after the fact).
create function orders.admin_force_cancel(p_order_id uuid, p_admin uuid, p_reason_code text, p_note text default null)
returns order_status
language plpgsql security definer
set search_path = pg_catalog, public, orders, audit, core
as $$
declare v_order orders.orders;
begin
  perform audit.validate_reason(p_reason_code, p_note);
  update orders.orders set status = 'cancelled'
    where id = p_order_id and status not in ('delivered', 'confirmed_received', 'cancelled', 'refunded', 'returned')
    returning * into v_order;
  if not found then
    if not exists (select 1 from orders.orders where id = p_order_id) then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
    raise exception 'ORDER_NOT_CANCELLABLE' using errcode = 'P0005';
  end if;

  insert into core.outbox (name, version, actor_sub, actor_role, payload)                   -- EV-PC-014
    values ('orders.order.cancelled', 1, p_admin, 'admin',
            jsonb_build_object('order_id', p_order_id, 'reason_code', p_reason_code, 'by_role', 'admin'));
  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after, reason)
    values (p_admin, 'admin', 'order.force_cancel', 'orders.orders', p_order_id::text,
            jsonb_build_object('status', v_order.status), jsonb_build_object('status', 'cancelled'), coalesce(p_note, p_reason_code));

  return 'cancelled'::order_status;
end $$;
comment on function orders.admin_force_cancel(uuid, uuid, text, text) is 'AC-05 EP-AC-041 FR-AC05-001/002';
grant execute on function orders.admin_force_cancel(uuid, uuid, text, text) to app_service_role;

-- EP-AC-042: reason-coded address edit (before dispatch only -- editing an
-- address after a driver is already en route would silently desync the
-- physical route, so this blocks the same statuses DL-01 has already
-- assigned/moved past).
create function orders.admin_edit_address(p_order_id uuid, p_admin uuid, p_address jsonb, p_reason_code text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, orders, audit
as $$
declare v_before jsonb; v_status order_status;
begin
  perform audit.validate_reason(p_reason_code, null);
  select address_snapshot, status into v_before, v_status from orders.orders where id = p_order_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_status in ('assigned', 'picked_up', 'en_route', 'delivered', 'confirmed_received') then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;
  update orders.orders set address_snapshot = p_address where id = p_order_id;
  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after, reason)
    values (p_admin, 'admin', 'order.address_edit', 'orders.orders', p_order_id::text, v_before, p_address, p_reason_code);
end $$;
comment on function orders.admin_edit_address(uuid, uuid, jsonb, text) is 'AC-05 EP-AC-042 FR-AC05-001';
grant execute on function orders.admin_edit_address(uuid, uuid, jsonb, text) to app_service_role;

-- EP-AC-043: return decision. Approval computes a real refund amount
-- (per-unit apportionment of each returned line's own order_lines.line_total,
-- inclusive of VAT) -- closes the documented S13 gap ("refund amount is a
-- real, documented gap — always 0, no VAT-apportionment calc built"). Emits
-- orders.return.approved (EV-PC-015); dispatchWorker.ts's own comment already
-- names this as the event it deliberately doesn't consume yet ("nothing in
-- this codebase produces it yet") -- it does now, but wiring an actual
-- return-pickup delivery task is DL's own schema to own (one-body rule), not
-- built here; still an accurate SPEC-GAP, not silently dropped, same
-- reasoning EP-DL-050/051 already carried forward from S10/S11.
create function orders.admin_decide_return(p_return_id uuid, p_admin uuid, p_decision text, p_reason_code text)
returns text
language plpgsql security definer
set search_path = pg_catalog, orders, audit, core
as $$
declare v_return orders.returns; v_refund_amount numeric := 0; v_new_status text;
begin
  perform audit.validate_reason(p_reason_code, null);
  if p_decision not in ('approve', 'reject') then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;

  select * into v_return from orders.returns where id = p_return_id and status = 'requested' for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;

  v_new_status := case p_decision when 'approve' then 'approved' else 'rejected' end;
  update orders.returns set status = v_new_status where id = p_return_id;

  if p_decision = 'approve' then
    select coalesce(sum((ol.line_total / ol.qty) * rl.qty), 0) into v_refund_amount
      from orders.return_lines rl join orders.order_lines ol on ol.id = rl.order_line_id
      where rl.return_id = p_return_id;

    insert into orders.refunds (order_id, return_id, amount, method)
      values (v_return.order_id, p_return_id, v_refund_amount, 'bank_transfer');

    insert into core.outbox (name, version, payload)                            -- EV-PC-015
      values ('orders.return.approved', 1, jsonb_build_object('return_id', p_return_id, 'order_id', v_return.order_id, 'refund_amount', v_refund_amount));
  end if;

  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after, reason)
    values (p_admin, 'admin', 'return.decision', 'orders.returns', p_return_id::text,
            jsonb_build_object('status', 'requested'), jsonb_build_object('status', v_new_status, 'refundAmount', v_refund_amount), p_reason_code);

  return v_new_status;
end $$;
comment on function orders.admin_decide_return(uuid, uuid, text, text) is 'AC-05 EP-AC-043 FR-AC05-004 — closes the S13 refund-amount gap';
grant execute on function orders.admin_decide_return(uuid, uuid, text, text) to app_service_role;

-- EP-AC-044: review moderation. This schema has no distinct 'hidden' status
-- (orders.reviews.status: pending|approved|rejected, 0051) -- both 'hide'
-- and 'remove' map to 'rejected' (both remove it from
-- orders.v_sku_review_summary / the public product page); SCOPED
-- SIMPLIFICATION, documented, not a silent conflation.
create function orders.admin_moderate_review(p_review_id uuid, p_admin uuid, p_action text, p_reason_code text)
returns void
language plpgsql security definer
set search_path = pg_catalog, orders, audit
as $$
declare v_before text;
begin
  perform audit.validate_reason(p_reason_code, null);
  if p_action not in ('hide', 'remove') then raise exception 'VALIDATION_ERROR' using errcode = '22023'; end if;
  select status into v_before from orders.reviews where id = p_review_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  update orders.reviews set status = 'rejected' where id = p_review_id;
  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after, reason)
    values (p_admin, 'admin', 'review.moderate', 'orders.reviews', p_review_id::text,
            jsonb_build_object('status', v_before), jsonb_build_object('status', 'rejected', 'moderationAction', p_action), p_reason_code);
end $$;
comment on function orders.admin_moderate_review(uuid, uuid, text, text) is 'AC-05 EP-AC-044 FR-AC05-005';
grant execute on function orders.admin_moderate_review(uuid, uuid, text, text) to app_service_role;

-- Down Migration

revoke execute on function orders.admin_moderate_review(uuid, uuid, text, text) from app_service_role;
drop function if exists orders.admin_moderate_review(uuid, uuid, text, text);

revoke execute on function orders.admin_decide_return(uuid, uuid, text, text) from app_service_role;
drop function if exists orders.admin_decide_return(uuid, uuid, text, text);

revoke execute on function orders.admin_edit_address(uuid, uuid, jsonb, text) from app_service_role;
drop function if exists orders.admin_edit_address(uuid, uuid, jsonb, text);

revoke execute on function orders.admin_force_cancel(uuid, uuid, text, text) from app_service_role;
drop function if exists orders.admin_force_cancel(uuid, uuid, text, text);

revoke execute on function audit.validate_reason(text, text) from app_service_role;
drop function if exists audit.validate_reason(text, text);
