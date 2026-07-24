-- Up Migration
-- Supabase security advisor (ERROR, rls_disabled_in_public): public.pgmigrations
-- is node-pg-migrate's own bookkeeping table (auto-created the first time any
-- migration runs, not one of this project's own 04-database-design tables),
-- and every public-schema table is exposed via PostgREST by default on this
-- project's real Supabase instance. With RLS disabled, anyone holding the
-- project's anon key could read/write migration name/timestamp rows over the
-- public REST API. Low sensitivity (no business data in this table) but a
-- real gap against this project's own "RLS enabled everywhere" rule
-- (05-master-database-architecture.md). No FORCE here (unlike the app schema
-- tables elsewhere in this suite): the role node-pg-migrate itself connects
-- as owns this table (it created it) and table owners already bypass RLS by
-- default without FORCE, so `db:migrate:up` keeps working unmodified; FORCE
-- would additionally subject the owner to policies, which is unnecessary for
-- an internal bookkeeping table with no legitimate end-user access path.
alter table public.pgmigrations enable row level security;

grant all privileges on public.pgmigrations to app_service_role;
create policy pgmigrations_service_role_all on public.pgmigrations
  for all
  to app_service_role
  using (true)
  with check (true);

-- Down Migration

drop policy if exists pgmigrations_service_role_all on public.pgmigrations;
revoke all privileges on public.pgmigrations from app_service_role;
alter table public.pgmigrations disable row level security;
