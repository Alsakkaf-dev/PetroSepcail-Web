-- Up Migration
-- Two real, verified permission gaps found live against production Supabase
-- (Vercel runtime logs showed real 500s the first time each path was actually
-- exercised, not a hypothetical review finding):
--
-- 1. `credit.v_exposure`/`credit.v_receivables_aging` (0054) and
--    `delivery.v_driver_kpis` (0042) were created without a matching grant.
--    `catalog.v_pickup_points` — defined in the same block of 0054 — correctly
--    got `grant select ... to app_user` right after its own CREATE VIEW; these
--    three simply never did. Runtime error: "permission denied for view
--    v_exposure" / "permission denied for view v_driver_kpis" from
--    adminFinance.ts, adminCredit.ts, adminAnalytics.ts, adminFleet.ts (all
--    `withServiceRoleTransaction`, i.e. `app_service_role`) and from
--    supplierStatement.ts's own read of `credit.v_exposure` for a supplier's
--    statement page (`withRlsTransaction`, i.e. `app_user`).
--
-- 2. `audit.compute_row_hash()` (0005) calls pgcrypto's `digest()` unqualified;
--    0033 already hardened its search_path to `pg_catalog, public, extensions`
--    (confirmed still correct in prod: `pg_proc.proconfig`), but no app role
--    was ever granted USAGE on schema `extensions` itself — an unqualified
--    reference to a schema you can't see into resolves as "does not exist"
--    (not "permission denied"), which is exactly the runtime error seen:
--    "function digest(text, unknown) does not exist" from adminUsers.ts
--    provisioning a new supplier/driver/admin account. Confirmed directly:
--    `set local role app_service_role; select extensions.digest('a','sha256')`
--    returns "permission denied for schema extensions". Since this trigger
--    fires on every insert into audit.audit_log, from every schema, this
--    blocked audit-logged writes system-wide wherever actually exercised.

grant usage on schema extensions to app_user, app_service_role;

grant select on credit.v_exposure to app_user, app_service_role;
grant select on credit.v_receivables_aging to app_service_role;
grant select on delivery.v_driver_kpis to app_service_role;

-- Down Migration

revoke select on delivery.v_driver_kpis from app_service_role;
revoke select on credit.v_receivables_aging from app_service_role;
revoke select on credit.v_exposure from app_user, app_service_role;

revoke usage on schema extensions from app_user, app_service_role;
