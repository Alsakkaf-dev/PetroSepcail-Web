-- Up Migration
-- 40-admin-center/08-implementation-guide.md §2 (AC-PRIV-1/AC-10, S18).

create function audit.create_pdpl_request(p_subject uuid, p_kind text, p_admin uuid)
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
grant execute on function audit.create_pdpl_request(uuid, text, uuid) to app_service_role;

-- FR-AC10-003: grace -> executing -> completed. Deletion cascades are NOT
-- implemented here (a real erasure cascade across every schema referencing
-- core.identities is a large, cross-cutting operation — SPEC-GAP, documented
-- rather than a fabricated success); this advances the case state machine
-- and logs each step, which is the auditable workflow FR-AC10-003 actually
-- asks for ("each step audited").
create function audit.advance_pdpl_request(p_request_id uuid, p_admin uuid)
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
grant execute on function audit.advance_pdpl_request(uuid, uuid) to app_service_role;

create function audit.open_breach(p_detected_at timestamptz, p_scope text, p_admin uuid)
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
grant execute on function audit.open_breach(timestamptz, text, uuid) to app_service_role;

-- Down Migration

revoke execute on function audit.open_breach(timestamptz, text, uuid) from app_service_role;
drop function if exists audit.open_breach(timestamptz, text, uuid);

revoke execute on function audit.advance_pdpl_request(uuid, uuid) from app_service_role;
drop function if exists audit.advance_pdpl_request(uuid, uuid);

revoke execute on function audit.create_pdpl_request(uuid, text, uuid) from app_service_role;
drop function if exists audit.create_pdpl_request(uuid, text, uuid);
