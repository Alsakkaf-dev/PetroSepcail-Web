-- Up Migration
-- 05-master-database-architecture §4.1: "the platform's own worker processes
-- connect with a dedicated service_role Postgres role ... and are the only
-- bypass." Everything else (the API pool, all customer/supplier/driver/admin
-- traffic alike) is RLS-bound: authorization is carried entirely in the JWT
-- claims session var (auth.jwt()), not in which Postgres role is connected,
-- so one generic RLS-bound role (app_user) is enough. Both are NOLOGIN
-- membership roles, granted to whichever bootstrap role runs migrations
-- (current_user) — parity-safe (D-13): no role name is tier-specific.

create role service_role nologin bypassrls;
comment on role service_role is
  'PC-03 §4.1 — background workers/dispatcher connection; bypasses RLS entirely.';

create role app_user nologin;
comment on role app_user is
  'PC-03 §4.1 — the single RLS-bound Postgres role for all API-gateway traffic; '
  'per-identity/per-role authorization comes from the request.jwt.claims session '
  'var read by auth.jwt(), not from which Postgres role is connected.';

grant service_role to current_user;
grant app_user to current_user;

-- Down Migration

revoke app_user from current_user;
revoke service_role from current_user;
drop role if exists app_user;
drop role if exists service_role;
