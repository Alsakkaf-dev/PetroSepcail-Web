-- Up Migration
-- 40-admin-center/04-database-design.md §3/§5 (AC-CRED-1/AC-FLEET-1/AC-ANL-1,
-- S17/S18).

-- AC-03 FR-AC03-001/002: >SAR 100,000 needs a super_admin + a second-admin
-- dual-control ack (audit.dual_control_approvals, 0064) before it commits.
create function credit.admin_set_credit_limit(p_supplier uuid, p_new numeric, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, credit, audit, core
as $$
declare v_threshold numeric := 100000; v_role text := app_auth.jwt()->>'role'; v_old numeric;
begin
  select limit_amount into v_old from credit.credit_limits where supplier_id = p_supplier and is_current;
  if p_new > v_threshold then
    if v_role <> 'super_admin' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    if not exists (select 1 from audit.dual_control_approvals
                   where request_kind = 'credit_limit_over_threshold' and status = 'approved'
                     and (payload->>'supplier_id')::uuid = p_supplier and (payload->>'new_limit')::numeric = p_new) then
      insert into audit.dual_control_approvals (request_kind, payload, requested_by)
        values ('credit_limit_over_threshold',
                jsonb_build_object('supplier_id', p_supplier, 'new_limit', p_new, 'requested_by', app_auth.jwt()->>'sub'),
                (app_auth.jwt()->>'sub')::uuid);
      return jsonb_build_object('status', 'pending_dual_control');
    end if;
  end if;

  update credit.credit_limits set is_current = false where supplier_id = p_supplier and is_current;
  insert into credit.credit_limits (supplier_id, limit_amount, is_current, set_by, reason)
    values (p_supplier, p_new, true, (app_auth.jwt()->>'sub')::uuid, p_reason);

  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after, reason)
    values ((app_auth.jwt()->>'sub')::uuid, v_role, 'credit.limit.change', 'credit.credit_limits', p_supplier::text,
            jsonb_build_object('limit', v_old), jsonb_build_object('limit', p_new), p_reason);
  insert into core.outbox (name, version, payload)                                -- EV-PC-034
    values ('credit.limit.changed', 1, jsonb_build_object('supplier_id', p_supplier, 'old', v_old, 'new', p_new, 'by', app_auth.jwt()->>'sub'));

  return jsonb_build_object('status', 'applied', 'newLimit', p_new);
end $$;
comment on function credit.admin_set_credit_limit(uuid, numeric, text) is 'AC-03 FR-AC03-001/002 — dual-control gated above SAR 100,000';
grant execute on function credit.admin_set_credit_limit(uuid, numeric, text) to app_service_role;

-- AC-03: the tier-assignment half (SP-01's own credit.update_supplier_profile
-- structurally excludes tier -- this is the admin-only counterpart).
create function credit.admin_set_supplier_tier(p_supplier uuid, p_tier text, p_reason text)
returns void
language plpgsql security definer
set search_path = pg_catalog, credit, audit
as $$
declare v_old text;
begin
  if app_auth.jwt()->>'role' not in ('admin', 'super_admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select tier into v_old from credit.suppliers where id = p_supplier;
  update credit.suppliers set tier = p_tier, updated_at = now() where id = p_supplier;
  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after, reason)
    values ((app_auth.jwt()->>'sub')::uuid, app_auth.jwt()->>'role', 'credit.tier.change', 'credit.suppliers', p_supplier::text,
            jsonb_build_object('tier', v_old), jsonb_build_object('tier', p_tier), p_reason);
end $$;
comment on function credit.admin_set_supplier_tier(uuid, text, text) is 'AC-03 — admin-only tier assignment, audited';
grant execute on function credit.admin_set_supplier_tier(uuid, text, text) to app_service_role;

-- AC-09/D-14 rule g: per-entity audit cadence override, no redeploy.
create function delivery.admin_set_audit_interval(p_kind text, p_entity uuid, p_interval_days int)
returns void
language plpgsql security definer
set search_path = pg_catalog, delivery, audit, core
as $$
begin
  if app_auth.jwt()->>'role' <> 'super_admin' then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  insert into delivery.audit_schedules (entity_kind, entity_id, interval_days, next_due, updated_by)
    values (p_kind, p_entity, p_interval_days, (now() + (p_interval_days || ' days')::interval)::date, (app_auth.jwt()->>'sub')::uuid)
    on conflict (entity_kind, entity_id) do update
      set interval_days = excluded.interval_days, next_due = (now() + (excluded.interval_days || ' days')::interval)::date,
          updated_by = excluded.updated_by, updated_at = now();
  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
    values ((app_auth.jwt()->>'sub')::uuid, 'super_admin', 'delivery.audit_cadence.set', 'delivery.audit_schedules', p_entity::text,
            jsonb_build_object('interval_days', p_interval_days));
  insert into core.outbox (name, version, payload)                                -- EV-PC-050
    values ('platform.config.changed', 1, jsonb_build_object('key', 'audit_interval', 'entity', p_entity, 'value', p_interval_days, 'by', app_auth.jwt()->>'sub'));
end $$;
comment on function delivery.admin_set_audit_interval(text, uuid, int) is 'AC-09/D-14g — per-entity cadence override, no redeploy';
grant execute on function delivery.admin_set_audit_interval(text, uuid, int) to app_service_role;

-- AC-01 FR-AC01: aggregate-only rollups, k>=5 anonymity floor, no PII column.
create view orders.v_sales_kpi as
select date_trunc('day', placed_at) as day, kind,
       count(*) as orders, count(distinct user_id) as buyers,
       sum(total) as gross, sum(discount_amount) as discounts,
       sum(total) filter (where status in ('refunded', 'returned')) as reversed
from orders.orders
group by 1, 2
having count(distinct user_id) >= (select (value)::int from core.settings where key = 'k_anon_floor');
comment on view orders.v_sales_kpi is 'AC-01 rollup; k-anon floored; NO PII column';

create view orders.v_bestsellers_family as
select date_trunc('week', o.placed_at) as week, ps.sku_id, sum(ol.qty) as qty, sum(ol.qty * ol.unit_price) as revenue
from orders.orders o
join orders.order_lines ol on ol.order_id = o.id
join catalog.pack_sizes ps on ps.id = ol.pack_size_id
group by 1, 2;
comment on view orders.v_bestsellers_family is 'AC-01 rollup; aggregates only';

-- Not granted to app_user: RLS is table-level, not view-level, so an app_user
-- grant here would not actually restrict this to admin/super_admin the way
-- 04-database-design §4's "grant SELECT to admin/super_admin only" requires
-- (the underlying orders.orders/order_lines RLS would just silently narrow a
-- customer's own view instead of denying it outright). The route layer gates
-- this with requirePermission("read","analytics") (04-roles §4.1, already
-- admin/super_admin-only in authz.ts) and reads over app_service_role.
grant select on orders.v_sales_kpi, orders.v_bestsellers_family to app_service_role;

-- Down Migration

revoke select on orders.v_sales_kpi, orders.v_bestsellers_family from app_service_role;
drop view if exists orders.v_bestsellers_family;
drop view if exists orders.v_sales_kpi;

revoke execute on function delivery.admin_set_audit_interval(text, uuid, int) from app_service_role;
drop function if exists delivery.admin_set_audit_interval(text, uuid, int);

revoke execute on function credit.admin_set_supplier_tier(uuid, text, text) from app_service_role;
drop function if exists credit.admin_set_supplier_tier(uuid, text, text);

revoke execute on function credit.admin_set_credit_limit(uuid, numeric, text) from app_service_role;
drop function if exists credit.admin_set_credit_limit(uuid, numeric, text);
