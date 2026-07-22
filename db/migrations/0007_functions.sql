-- Up Migration
-- 04-database-design §5 (key functions), verbatim.

-- FR-PC03-004: the ONLY admin path to customer PII.
create function core.admin_read_customer(p_customer uuid, p_reason text)
returns core.identities language plpgsql security definer as $$
declare r core.identities;
begin
  if (app_auth.jwt()->>'role') not in ('admin','super_admin') then raise exception 'forbidden'; end if;
  insert into audit.audit_log(actor_id, actor_role, action, resource, resource_id, reason, at)
    values ((app_auth.jwt()->>'sub')::uuid, app_auth.jwt()->>'role','pii_read','identity',p_customer::text,p_reason, now());
  select * into r from core.identities where id = p_customer;  -- single record only
  return r;
end $$;
comment on function core.admin_read_customer(uuid, text) is
  'PC-03 §5/FR-PC03-004 — SECURITY DEFINER: runs as the migration owner, so '
  'it reads core.identities and writes audit.audit_log regardless of the '
  'caller''s RLS visibility. row_hash/prev_hash are filled automatically by '
  'audit.compute_row_hash() (0005_audit_schema.sql).';

-- PC-12: read a setting with cache-friendly signature.
create function core.get_setting(p_key text) returns jsonb language sql stable as $$
  select value from core.settings where key = p_key $$;
comment on function core.get_setting(text) is
  'PC-12/TC-PC12-001 — stable read of a single settings key. Runs as caller '
  '(no SECURITY DEFINER), so it is still gated by settings_admin_read RLS for '
  'app_user; server-side business logic that needs it for anonymous/customer '
  'flows (e.g. VAT display) calls it over a app_service_role connection.';

-- Down Migration

drop function if exists core.get_setting(text);
drop function if exists core.admin_read_customer(uuid, text);
