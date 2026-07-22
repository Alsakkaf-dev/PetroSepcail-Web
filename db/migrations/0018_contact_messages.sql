-- Up Migration
-- PC-11 (TC-PC11-002/FR-PC11-004): SPEC-GAP — 04-database-design.md defines
-- no `core.contact_messages` table at all (checked: zero matches across the
-- spec suite). The legacy site's own contact form (assets/js/main.js
-- ~L316-322) posts { name, email, phone, message, locale } straight to a
-- Supabase `contact_messages` table via PostgREST, plus Supabase's own
-- auto `id`/`created_at`. This table exists solely to receive a one-time
-- import of that legacy data (scripts/import-legacy-contact-messages.mjs)
-- so it isn't lost — it is NOT a live submission endpoint for this platform
-- (no session in the roadmap owns a "contact us" API yet; if/when one is
-- built, it should target this same table and this migration's shape).
-- Least-surprising reading of the legacy payload: `id`/`created_at` become
-- the real PK/timestamp, `phone` stays optional (the legacy form doesn't
-- mark it required — see the validate() logic above the payload build),
-- `locale` mirrors D-01's ar/en split. service_role-only (no end-user RLS
-- policy exists yet, same precedent as core.outbox/ops.incidents) since
-- there is no authenticated "owner" of an anonymous contact message.

create table core.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  message text not null,
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  created_at timestamptz not null default now(),
  -- Idempotency fallback for import rows whose legacy source had no usable
  -- id (see the import script's --file handling): a given email can only
  -- submit once per exact created_at timestamp.
  unique (email, created_at)
);
comment on table core.contact_messages is
  'PC-11 SPEC-GAP — no 04-database-design definition exists; shape reverse-'
  'engineered from the legacy site''s contact-form payload for a one-time '
  'import (TC-PC11-002). service_role-only, not a live submission endpoint.';

alter table core.contact_messages enable row level security;
alter table core.contact_messages force row level security;

grant usage on schema core to service_role;
grant select, insert on core.contact_messages to service_role;

-- Down Migration

revoke select, insert on core.contact_messages from service_role;

alter table core.contact_messages disable row level security;
drop table core.contact_messages;
