-- Up Migration
-- AC-10 (S18) precondition check surfaced two real gaps in already-shipped
-- migrations, fixed here as corrective migrations (append-only, 0005/0007
-- are never edited in place).
--
-- (1) core.admin_read_customer (0007) returns `core.identities` (SELECT *),
-- which includes `password_hash` (argon2id) -- a customer's password hash
-- was reachable from any admin PII-read call. NFR-AC-002/003 (single-record,
-- curated PII read) plus basic least-privilege both say a hash should never
-- cross this boundary at all, hashed or not. Also missing: the reason
-- argument was accepted even when null/empty, so the "reason-mandatory"
-- guarantee (04-database-design §5's own draft, FR-AC10-001) was unenforced.
-- Return type changes uuid->jsonb, which CREATE OR REPLACE cannot do, so
-- this drops and recreates rather than replacing in place.
drop function if exists core.admin_read_customer(uuid, text);
create function core.admin_read_customer(p_customer uuid, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, core, audit
as $$
declare v jsonb;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED' using errcode = '23514';
  end if;
  if (app_auth.jwt()->>'role') not in ('admin', 'super_admin') then raise exception 'forbidden'; end if;
  insert into audit.audit_log(actor_id, actor_role, action, resource, resource_id, reason, at)
    values ((app_auth.jwt()->>'sub')::uuid, app_auth.jwt()->>'role', 'pii_read', 'identity', p_customer::text, p_reason, now());
  select jsonb_build_object('id', i.id, 'fullName', i.full_name, 'phone', i.phone, 'email', i.email, 'status', i.status)
    into v from core.identities i where i.id = p_customer;
  if v is null then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  return v;
end $$;
comment on function core.admin_read_customer(uuid, text) is
  'PC-03/AC-10 FR-PC03-004/FR-AC10-001 — curated jsonb (no password_hash), reason mandatory, audit-first';
grant execute on function core.admin_read_customer(uuid, text) to app_service_role;

-- (2) audit.audit_log has RLS enabled+forced (0006) but NO SELECT POLICY was
-- ever added -- meaning nobody (not even admin/super_admin) could read the
-- audit log through app_user at all; only app_service_role's blanket grant
-- worked. AC-07's own "admin reads own actions, super_admin reads all"
-- requirement (04-roles §3) needs this policy to exist for EP-AC-060/061 to
-- be buildable as an RLS-scoped (not just service-role-bypassed) read.
grant select on audit.audit_log to app_user;
create policy audit_admin_own on audit.audit_log for select
  using ((app_auth.jwt()->>'role' = 'admin' and actor_id = (app_auth.jwt()->>'sub')::uuid)
      or app_auth.jwt()->>'role' = 'super_admin');

-- Down Migration

drop policy if exists audit_admin_own on audit.audit_log;
revoke select on audit.audit_log from app_user;

revoke execute on function core.admin_read_customer(uuid, text) from app_service_role;
drop function if exists core.admin_read_customer(uuid, text);
create function core.admin_read_customer(p_customer uuid, p_reason text)
returns core.identities language plpgsql security definer as $$
declare r core.identities;
begin
  if (app_auth.jwt()->>'role') not in ('admin','super_admin') then raise exception 'forbidden'; end if;
  insert into audit.audit_log(actor_id, actor_role, action, resource, resource_id, reason, at)
    values ((app_auth.jwt()->>'sub')::uuid, app_auth.jwt()->>'role','pii_read','identity',p_customer::text,p_reason, now());
  select * into r from core.identities where id = p_customer;
  return r;
end $$;
