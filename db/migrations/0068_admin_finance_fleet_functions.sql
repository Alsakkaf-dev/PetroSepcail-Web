-- Up Migration
-- 40-admin-center/08-implementation-guide.md §5 (AC-FIN-1/AC-CUSTODY-1/
-- AC-FLEET-1, S18).

-- delivery.driver_cash_custody (0039, D-14 rule f, driver side) never had a
-- remittance-verification writer — delivery.shifts' own close-gate (0047)
-- checks for an unremitted 'held' row but nothing ever transitions one to
-- 'remitted'. Real, previously-undiscovered gap; same shape
-- credit.remit_custody (0061, supplier side) already established, adapted
-- to this table's own columns (id, not custody_ref — that column only
-- exists on the supplier-side table).
create function delivery.admin_verify_driver_remittance(p_custody_id uuid, p_amount numeric, p_admin uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, delivery, audit
as $$
declare v_held numeric; v_remittance_ref uuid := gen_random_uuid();
begin
  select amount into v_held from delivery.driver_cash_custody where id = p_custody_id and status = 'held';
  if not found then raise exception 'CUSTODY_MISMATCH' using errcode = 'P0024'; end if;
  if p_amount <> v_held then raise exception 'CUSTODY_MISMATCH' using errcode = 'P0024', detail = jsonb_build_object('held', v_held, 'submitted', p_amount)::text; end if;

  update delivery.driver_cash_custody set status = 'remitted', remitted_at = now(), remittance_ref = v_remittance_ref where id = p_custody_id;

  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
    values (p_admin, 'admin', 'custody.driver.remitted', 'delivery.driver_cash_custody', p_custody_id::text, jsonb_build_object('amount', p_amount));
end $$;
comment on function delivery.admin_verify_driver_remittance(uuid, numeric, uuid) is 'AC-08 EP-AC-073 FR-AC08-003 — driver-side custody verification; D-14 rule f, never touches credit/exposure';
grant execute on function delivery.admin_verify_driver_remittance(uuid, numeric, uuid) to app_service_role;

-- Supplier-side custody remittance verification wrapper — reuses
-- credit.remit_custody (0061) but adds the CUSTODY_MISMATCH amount check
-- EP-AC-073 asks for ("a short remittance -> 409 CUSTODY_MISMATCH") that
-- credit.remit_custody itself doesn't do (it only checks the row exists +
-- is held, not that the amount matches).
create function credit.admin_verify_supplier_remittance(p_custody_ref uuid, p_amount numeric, p_admin uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, credit, audit
as $$
declare v_held numeric;
begin
  select amount into v_held from credit.custody_ledger where custody_ref = p_custody_ref and status = 'held';
  if not found then raise exception 'CUSTODY_MISMATCH' using errcode = 'P0024'; end if;
  if p_amount <> v_held then raise exception 'CUSTODY_MISMATCH' using errcode = 'P0024', detail = jsonb_build_object('held', v_held, 'submitted', p_amount)::text; end if;

  perform credit.remit_custody(p_custody_ref, gen_random_uuid());

  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
    values (p_admin, 'admin', 'custody.supplier.remitted', 'credit.custody_ledger', p_custody_ref::text, jsonb_build_object('amount', p_amount));
end $$;
comment on function credit.admin_verify_supplier_remittance(uuid, numeric, uuid) is 'AC-08 EP-AC-073 FR-AC08-003 — supplier-side, wraps credit.remit_custody with the amount-match check';
grant execute on function credit.admin_verify_supplier_remittance(uuid, numeric, uuid) to app_service_role;

-- AC-FLEET-1: unassigned-task + exception alerts (EP-AC-083). Read-only, no
-- new table -- computed live from delivery.delivery_tasks/stock_audits.
create function delivery.admin_fleet_alerts()
returns table(kind text, ref text, severity text)
language sql stable security definer
set search_path = pg_catalog, delivery
as $$
  select 'unassigned_task'::text, t.id::text, 'high'::text
    from delivery.delivery_tasks t where t.status = 'assigned' and t.driver_id is null
  union all
  select 'audit_exception'::text, a.id::text, 'medium'::text
    from delivery.stock_audits a where a.status = 'exception'
  union all
  select 'unremitted_custody'::text, c.id::text, 'medium'::text
    from delivery.driver_cash_custody c where c.status = 'held' and c.collected_at < now() - interval '48 hours';
$$;
comment on function delivery.admin_fleet_alerts() is 'AC-09 EP-AC-083 FR-AC09-004';
grant execute on function delivery.admin_fleet_alerts() to app_service_role;

-- AC-FLEET-1: reassign an open task to a different driver.
create function delivery.admin_reassign_task(p_task_id uuid, p_new_driver uuid, p_admin uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = pg_catalog, delivery, audit
as $$
declare v_old_driver uuid;
begin
  select driver_id into v_old_driver from delivery.delivery_tasks where id = p_task_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  update delivery.delivery_tasks set driver_id = p_new_driver, status = 'assigned' where id = p_task_id;
  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after, reason)
    values (p_admin, 'admin', 'fleet.task.reassign', 'delivery.delivery_tasks', p_task_id::text,
            jsonb_build_object('driverId', v_old_driver), jsonb_build_object('driverId', p_new_driver), p_reason);
end $$;
comment on function delivery.admin_reassign_task(uuid, uuid, uuid, text) is 'AC-09 EP-AC-083 FR-AC09-004';
grant execute on function delivery.admin_reassign_task(uuid, uuid, uuid, text) to app_service_role;

-- Down Migration

revoke execute on function delivery.admin_reassign_task(uuid, uuid, uuid, text) from app_service_role;
drop function if exists delivery.admin_reassign_task(uuid, uuid, uuid, text);

revoke execute on function delivery.admin_fleet_alerts() from app_service_role;
drop function if exists delivery.admin_fleet_alerts();

revoke execute on function credit.admin_verify_supplier_remittance(uuid, numeric, uuid) from app_service_role;
drop function if exists credit.admin_verify_supplier_remittance(uuid, numeric, uuid);

revoke execute on function delivery.admin_verify_driver_remittance(uuid, numeric, uuid) from app_service_role;
drop function if exists delivery.admin_verify_driver_remittance(uuid, numeric, uuid);
