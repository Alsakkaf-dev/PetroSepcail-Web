-- Up Migration
-- 05-master-database-architecture §4.1: "the platform's own worker processes
-- connect with a dedicated app_service_role Postgres role ... and are the only
-- bypass." Everything else (the API pool, all customer/supplier/driver/admin
-- traffic alike) is RLS-bound: authorization is carried entirely in the JWT
-- claims session var (app_auth.jwt()), not in which Postgres role is connected,
-- so one generic RLS-bound role (app_user) is enough. Both are NOLOGIN
-- membership roles, granted to the bootstrap role that runs migrations.
-- SPEC-GAP (managed-Postgres migration): originally `current_user` (parity-
-- safe, D-13 — no role name is tier-specific). On Supabase, `grant ... to
-- current_user` inside this DDL reliably drops the connection (observed:
-- the connection terminates with no SQL error; a literal target name does
-- not). Supabase's bootstrap user is always named `postgres`, so this is
-- hardcoded here rather than kept dynamic — a deliberate, narrow exception
-- to D-13 for this one statement, not a project-wide policy change.
create role app_service_role nologin bypassrls;
comment on role app_service_role is
  'PC-03 §4.1 — background workers/dispatcher connection; bypasses RLS entirely.';

create role app_user nologin;
comment on role app_user is
  'PC-03 §4.1 — the single RLS-bound Postgres role for all API-gateway traffic; '
  'per-identity/per-role authorization comes from the request.jwt.claims session '
  'var read by app_auth.jwt(), not from which Postgres role is connected.';

grant app_service_role to postgres;
grant app_user to postgres;

-- Down Migration

revoke app_user from postgres;
revoke app_service_role from postgres;
drop role if exists app_user;
drop role if exists app_service_role;
