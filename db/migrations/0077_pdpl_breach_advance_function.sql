-- Up Migration
-- AC-10 (0067's own PDPL function set): audit.open_breach starts a
-- breach-notification case at 'open', matching audit.breach_notifications'
-- own check constraint ('open','regulator_notified','subjects_notified',
-- 'closed') — but no function anywhere ever advances it past that. The 72h
-- clock (notify_by) was trackable; the obligation it tracks was not
-- actionable. Same state-machine-only shape as 0067's own
-- audit.advance_pdpl_request: this logs each step, it does not perform the
-- actual regulator/subject notification (a real external act, out of scope
-- for a database function).
--
-- Role check included from this function's first version (0078 adds the
-- same check to 0067's three already-live functions, which shipped without
-- one) — building this alongside 0067's family surfaced that
-- create_pdpl_request/advance_pdpl_request/open_breach have no internal
-- role check at all, and the route-level `requirePermission("read",
-- "customer_pii")` gate they share also grants `customer` read/update on
-- that resource (04-roles §3: "Customer PII ... RU own"), so any signed-in
-- customer can currently call every one of those three routes successfully.
create function audit.advance_breach(p_breach_id uuid, p_admin uuid)
returns text
language plpgsql security definer
set search_path = pg_catalog, audit
as $$
declare v_current text; v_next text;
begin
  if (app_auth.jwt()->>'role') not in ('admin', 'super_admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select status into v_current from audit.breach_notifications where id = p_breach_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;

  v_next := case v_current
    when 'open' then 'regulator_notified'
    when 'regulator_notified' then 'subjects_notified'
    when 'subjects_notified' then 'closed'
    else v_current
  end;
  if v_next = v_current then raise exception 'CONFLICT' using errcode = 'P0003'; end if;

  update audit.breach_notifications set status = v_next, handled_by = p_admin where id = p_breach_id;

  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after)
    values (p_admin, 'admin', 'pdpl.breach.advanced', 'audit.breach_notifications', p_breach_id::text,
            jsonb_build_object('status', v_current), jsonb_build_object('status', v_next));

  return v_next;
end $$;
comment on function audit.advance_breach(uuid, uuid) is 'AC-10 EP-AC-097 — breach-notification state machine; mirrors advance_pdpl_request''s own shape';
grant execute on function audit.advance_breach(uuid, uuid) to app_service_role;

-- Down Migration

revoke execute on function audit.advance_breach(uuid, uuid) from app_service_role;
drop function if exists audit.advance_breach(uuid, uuid);
