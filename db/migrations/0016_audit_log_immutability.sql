-- Up Migration
-- PC-10 (FR-PC10-004/TC-PC10-002): "audit_log update/delete denied ... tamper
-- detected." 0006_rls_policies.sql granted app_service_role blanket
-- `all privileges on all tables in schema audit` (needed for INSERT, since
-- background workers/dispatcher write audit rows too) — but BYPASSRLS means
-- RLS's own `force row level security` on audit.audit_log gives app_service_role
-- no protection at all, so that blanket grant left UPDATE/DELETE open to the
-- one role that can actually reach the table. 0005 already revoked
-- UPDATE/DELETE from `public` (covering app_user, which has no audit.audit_log
-- grant at all regardless), but never re-revoked them from app_service_role
-- after 0006's blanket grant. Narrow it here: app_service_role keeps SELECT/
-- INSERT (needed for reads + the SECURITY DEFINER/worker insert paths) but
-- loses UPDATE/DELETE, so the table is genuinely immutable for every role
-- that can reach it, not just app_user.
revoke update, delete on audit.audit_log from app_service_role;

-- Down Migration

grant update, delete on audit.audit_log to app_service_role;
