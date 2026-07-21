-- Up Migration

-- citext: case-insensitive core.identities.email (04-database-design §3.1)
create extension if not exists citext;
-- pgcrypto: mfa_secrets encryption + audit hash chain digest() (04-database-design §3.4, §3.11)
create extension if not exists pgcrypto;
-- moddatetime: shared updated_at trigger (05-master-database-architecture §3)
create extension if not exists moddatetime;

-- Self-hosted equivalent of the well-known auth.jwt() convention (D-02/D-10:
-- self-built auth, not a vendor). RLS policies across every subsystem's
-- 04-database-design.md call auth.jwt() directly, so this must exist before
-- any policy is created.
create schema auth;
comment on schema auth is 'PC-03/PC-04 — self-hosted RLS claim-reader helpers; not a vendor schema.';

create function auth.jwt() returns jsonb
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;
comment on function auth.jwt() is
  'PC-03/PC-04 — reads the JWT claims the API gateway sets per-request via '
  '`set local request.jwt.claims` (PC-GW-3, S03). Returns null outside a '
  'request context (migrations, direct psql), which makes every claim-based '
  'RLS predicate default-deny.';

-- Down Migration

drop function if exists auth.jwt();
drop schema if exists auth;
drop extension if exists moddatetime;
drop extension if exists pgcrypto;
drop extension if exists citext;
