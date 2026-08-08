-- Up Migration
-- Real defect found while building 0077's admin/pdpl/breaches list route and
-- its own e2e test: audit.create_pdpl_request, audit.advance_pdpl_request
-- and audit.open_breach (0067) never check the caller's role internally —
-- every other admin-mutation SECURITY DEFINER function in this codebase
-- either takes an explicit p_admin-style role gate or checks
-- app_auth.jwt()->>'role' itself (0065's admin_set_credit_limit/
-- admin_set_supplier_tier/admin_set_audit_interval, 0063's
-- admin_read_customer). These three were the exception, and the route-level
-- gate they share (`requirePermission("read", "customer_pii")`,
-- adminGovernance.ts) does not compensate: 04-roles-and-permissions-matrix
-- §3 grants `customer` "RU own" on customer_pii, so `authorize()` allows a
-- plain customer role through that preHandler for these routes too.
--
-- Net effect, live in production since these routes shipped: any
-- authenticated customer can call POST /admin/pdpl/requests,
-- POST /admin/pdpl/requests/{id}/advance and POST /admin/pdpl/breaches
-- successfully — fabricating PDPL subject-rights requests against any
-- subjectId and opening fake data-breach notification records. Not
-- exploitable for PII disclosure (these functions write case-tracking
-- rows, not PII reads), but a real authorization boundary defect on a
-- compliance-critical surface.
--
-- Fix: the same `app_auth.jwt()->>'role' not in ('admin','super_admin')`
-- guard 0065/0077 already use, added to all three. Same signatures, so
-- CREATE OR REPLACE is sufficient — no drop needed (only 0063's
-- admin_read_customer needed that, for its return-type change).
create or replace function audit.create_pdpl_request(p_subject uuid, p_kind text, p_admin uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, audit, core
as $$
declare v_id uuid; v_grace_days int; v_grace_until date;
begin
  if (app_auth.jwt()->>'role') not in ('admin', 'super_admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select coalesce((core.get_setting('pdpl_grace_days'))::int, 30) into v_grace_days;
  v_grace_until := case when p_kind = 'deletion' then (now() + (v_grace_days || ' days')::interval)::date else null end;

  insert into audit.pdpl_requests (subject_id, kind, status, grace_until, handled_by)
    values (p_subject, p_kind, case when p_kind = 'deletion' then 'in_grace' else 'received' end, v_grace_until, p_admin)
    returning id into v_id;

  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
    values (p_admin, 'admin', 'pdpl.request.created', 'audit.pdpl_requests', v_id::text, jsonb_build_object('kind', p_kind));

  return jsonb_build_object('id', v_id, 'status', case when p_kind = 'deletion' then 'in_grace' else 'received' end, 'graceUntil', v_grace_until);
end $$;
comment on function audit.create_pdpl_request(uuid, text, uuid) is 'AC-10 EP-AC-091 FR-AC10-003; 0078 added the role check 0067 shipped without';

create or replace function audit.advance_pdpl_request(p_request_id uuid, p_admin uuid)
returns text
language plpgsql security definer
set search_path = pg_catalog, audit
as $$
declare v_current text; v_next text;
begin
  if (app_auth.jwt()->>'role') not in ('admin', 'super_admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select status into v_current from audit.pdpl_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;

  v_next := case v_current
    when 'received' then 'executing'
    when 'in_grace' then 'executing'
    when 'executing' then 'completed'
    else v_current
  end;
  if v_next = v_current then raise exception 'CONFLICT' using errcode = 'P0003'; end if;

  update audit.pdpl_requests set status = v_next, handled_by = p_admin,
    completed_at = case when v_next = 'completed' then now() else completed_at end
    where id = p_request_id;

  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after)
    values (p_admin, 'admin', 'pdpl.request.advanced', 'audit.pdpl_requests', p_request_id::text,
            jsonb_build_object('status', v_current), jsonb_build_object('status', v_next));

  return v_next;
end $$;
comment on function audit.advance_pdpl_request(uuid, uuid) is 'AC-10 EP-AC-092 FR-AC10-003 — state machine only; 0078 added the role check 0067 shipped without';

create or replace function audit.open_breach(p_detected_at timestamptz, p_scope text, p_admin uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, audit
as $$
declare v_id uuid; v_notify_by timestamptz;
begin
  if (app_auth.jwt()->>'role') not in ('admin', 'super_admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v_notify_by := p_detected_at + interval '72 hours';
  insert into audit.breach_notifications (detected_at, notify_by, scope, handled_by)
    values (p_detected_at, v_notify_by, p_scope, p_admin)
    returning id into v_id;
  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
    values (p_admin, 'admin', 'pdpl.breach.opened', 'audit.breach_notifications', v_id::text, jsonb_build_object('scope', p_scope));
  return jsonb_build_object('id', v_id, 'notifyBy', v_notify_by);
end $$;
comment on function audit.open_breach(timestamptz, text, uuid) is 'AC-10 EP-AC-093 FR-AC10-004 — 72h notification-obligation tracker; 0078 added the role check 0067 shipped without';

-- Down Migration
-- Reverts to 0067's original (unchecked) bodies, for a clean round-trip —
-- same convention as 0074's own down migration for capture_pod.

create or replace function audit.create_pdpl_request(p_subject uuid, p_kind text, p_admin uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, audit, core
as $$
declare v_id uuid; v_grace_days int; v_grace_until date;
begin
  select coalesce((core.get_setting('pdpl_grace_days'))::int, 30) into v_grace_days;
  v_grace_until := case when p_kind = 'deletion' then (now() + (v_grace_days || ' days')::interval)::date else null end;

  insert into audit.pdpl_requests (subject_id, kind, status, grace_until, handled_by)
    values (p_subject, p_kind, case when p_kind = 'deletion' then 'in_grace' else 'received' end, v_grace_until, p_admin)
    returning id into v_id;

  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
    values (p_admin, 'admin', 'pdpl.request.created', 'audit.pdpl_requests', v_id::text, jsonb_build_object('kind', p_kind));

  return jsonb_build_object('id', v_id, 'status', case when p_kind = 'deletion' then 'in_grace' else 'received' end, 'graceUntil', v_grace_until);
end $$;
comment on function audit.create_pdpl_request(uuid, text, uuid) is 'AC-10 EP-AC-091 FR-AC10-003';

create or replace function audit.advance_pdpl_request(p_request_id uuid, p_admin uuid)
returns text
language plpgsql security definer
set search_path = pg_catalog, audit
as $$
declare v_current text; v_next text;
begin
  select status into v_current from audit.pdpl_requests where id = p_request_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;

  v_next := case v_current
    when 'received' then 'executing'
    when 'in_grace' then 'executing'
    when 'executing' then 'completed'
    else v_current
  end;
  if v_next = v_current then raise exception 'CONFLICT' using errcode = 'P0003'; end if;

  update audit.pdpl_requests set status = v_next, handled_by = p_admin,
    completed_at = case when v_next = 'completed' then now() else completed_at end
    where id = p_request_id;

  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after)
    values (p_admin, 'admin', 'pdpl.request.advanced', 'audit.pdpl_requests', p_request_id::text,
            jsonb_build_object('status', v_current), jsonb_build_object('status', v_next));

  return v_next;
end $$;
comment on function audit.advance_pdpl_request(uuid, uuid) is 'AC-10 EP-AC-092 FR-AC10-003 — state machine only; cross-schema erasure cascade is a documented SPEC-GAP';

create or replace function audit.open_breach(p_detected_at timestamptz, p_scope text, p_admin uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, audit
as $$
declare v_id uuid; v_notify_by timestamptz;
begin
  v_notify_by := p_detected_at + interval '72 hours';
  insert into audit.breach_notifications (detected_at, notify_by, scope, handled_by)
    values (p_detected_at, v_notify_by, p_scope, p_admin)
    returning id into v_id;
  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
    values (p_admin, 'admin', 'pdpl.breach.opened', 'audit.breach_notifications', v_id::text, jsonb_build_object('scope', p_scope));
  return jsonb_build_object('id', v_id, 'notifyBy', v_notify_by);
end $$;
comment on function audit.open_breach(timestamptz, text, uuid) is 'AC-10 EP-AC-093 FR-AC10-004 — 72h notification-obligation tracker';
