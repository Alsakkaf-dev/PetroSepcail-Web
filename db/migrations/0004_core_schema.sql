-- Up Migration
-- core schema (04-database-design §3): PC-owned identity/notification/
-- config/outbox tables shared platform-wide. Column conventions per
-- 05-master-database-architecture §3 (uuid PK, created_at/updated_at,
-- numeric(12,2) money — none here yet — bilingual name_ar/name_en — none
-- here yet, this schema carries no bilingual content columns).

create schema core;

-- 3.1 identities ------------------------------------------------------------
create table core.identities (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null,
  email          citext not null unique,
  phone          text not null unique,            -- E.164
  password_hash  text not null,                   -- argon2id
  status         identity_status not null default 'pending_verification',
  locale         locale_code not null default 'ar',
  failed_logins  int not null default 0,
  locked_until   timestamptz,
  deletion_requested_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table core.identities is 'PC-01 — one row per human';
create index on core.identities (status);
create trigger set_updated_at before update on core.identities
  for each row execute function moddatetime(updated_at);

-- 3.2 role_grants -------------------------------------------------------------
create table core.role_grants (
  id           uuid primary key default gen_random_uuid(),
  identity_id  uuid not null references core.identities(id) on delete cascade,
  role         user_role not null,
  supplier_id  uuid,      -- set iff role='supplier' (FK to credit.suppliers, enforced by trigger cross-schema)
  driver_id    uuid,      -- set iff role='driver'   (FK to delivery.drivers)
  granted_by   uuid references core.identities(id),
  created_at   timestamptz not null default now(),
  unique (identity_id, role)
);
comment on table core.role_grants is 'PC-02 — roles attached to an identity; JWT carries one at a time';

-- 3.3 auth_tokens (refresh tokens, hashed) -----------------------------------
create table core.auth_tokens (
  id           uuid primary key default gen_random_uuid(),
  identity_id  uuid not null references core.identities(id) on delete cascade,
  family_id    uuid not null,                    -- rotation family
  token_hash   text not null,                    -- sha256 of refresh token
  role         user_role not null,               -- the single role this session runs as
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  rotated_at   timestamptz,
  revoked_at   timestamptz,
  user_agent   text, ip inet
);
create index on core.auth_tokens (identity_id) where revoked_at is null;
comment on table core.auth_tokens is 'PC-01 FR-PC01-004 — rotation + reuse detection';

-- 3.4 mfa_secrets / verification_tokens --------------------------------------
create table core.mfa_secrets (
  identity_id uuid primary key references core.identities(id) on delete cascade,
  totp_secret text not null,                      -- encrypted (pgcrypto)
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table core.mfa_secrets is 'PC-01 — TOTP MFA secrets (FR-PC01-011)';

create table core.verification_tokens (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references core.identities(id) on delete cascade,
  purpose text not null check (purpose in ('email_verify','password_reset')),
  token_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table core.verification_tokens is 'PC-01 — email-verify / password-reset single-use tokens';

-- 3.5 addresses ---------------------------------------------------------------
create table core.addresses (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references core.identities(id) on delete cascade,
  label text, recipient_name text not null, phone text not null,
  line1 text not null, line2 text, district text, city text not null default 'Jeddah',
  lat numeric(9,6), lng numeric(9,6),             -- pin-drop (ADR-09 fallback)
  is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
comment on table core.addresses is 'PC-01 / shared by SF-10, DL';
create trigger set_updated_at before update on core.addresses
  for each row execute function moddatetime(updated_at);

-- 3.6 consents (PDPL) ----------------------------------------------------------
create table core.consents (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references core.identities(id) on delete cascade,
  kind text not null check (kind in ('service_terms','privacy','marketing')),
  granted boolean not null,
  policy_version text not null,
  at timestamptz not null default now()
);
comment on table core.consents is 'PC-01 / NFR-PC-008 PDPL consent record';

-- 3.7 outbox (event bus) -------------------------------------------------------
create table core.outbox (
  event_id     uuid primary key default gen_random_uuid(),
  name         text not null,                     -- e.g. orders.order.confirmed (EV-PC catalog)
  version      int not null default 1,
  occurred_at  timestamptz not null default now(),
  actor_sub    uuid, actor_role text,
  payload      jsonb not null,
  dispatched_at timestamptz
);
create index on core.outbox (dispatched_at) where dispatched_at is null;
comment on table core.outbox is 'PC-05 — transactional outbox; drained by dispatcher';
-- NOTIFY trigger (pg_notify('outbox', event_id)) is PC-EV-1, wired in S04.

-- 3.8 notifications / notification_log -----------------------------------------
create table core.notifications (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references core.identities(id) on delete cascade,
  type text not null,                             -- maps to a bilingual template key
  params jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on core.notifications (identity_id, read_at);
comment on table core.notifications is 'PC-06 in-app center + channel fan-out source';

create table core.notification_log (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references core.notifications(id) on delete set null,
  channel notification_channel not null,
  status text not null check (status in ('queued','sent','failed')),
  error text, at timestamptz not null default now()
);
comment on table core.notification_log is 'PC-06 — per-channel delivery attempt log';

-- 3.9 i18n_strings / settings / feature_flags -----------------------------------
create table core.i18n_strings (
  key text primary key,                           -- section.item
  ar  text not null, en text not null, context text
);
comment on table core.i18n_strings is 'PC-07 — every user-facing string, keyed section.item, AR+EN both non-null';

create table core.settings (
  key text primary key, value jsonb not null,
  updated_by uuid references core.identities(id), updated_at timestamptz not null default now()
);
comment on table core.settings is 'PC-12 — every [BUSINESS-CONFIRM] value; change = no redeploy';
create trigger set_updated_at before update on core.settings
  for each row execute function moddatetime(updated_at);

create table core.feature_flags (
  key text primary key, value jsonb not null,     -- boolean or variant
  updated_by uuid references core.identities(id), updated_at timestamptz not null default now()
);
comment on table core.feature_flags is 'PC-12 — boolean/variant flags gating dormant features (e.g. payments.cards.enabled)';
create trigger set_updated_at before update on core.feature_flags
  for each row execute function moddatetime(updated_at);

-- 3.10 media_objects --------------------------------------------------------------
create table core.media_objects (
  id uuid primary key default gen_random_uuid(),
  bucket text not null, object_key text not null,
  content_type text not null, size_bytes bigint not null,
  uploaded_by uuid references core.identities(id),
  purpose text not null,                          -- product_image|pod_photo|invoice|transfer_proof
  created_at timestamptz not null default now(),
  expires_at timestamptz,                          -- lifecycle (PC-09 FR-PC09-004)
  unique (bucket, object_key)
);
comment on table core.media_objects is 'PC-09 — MinIO object registry; signed-URL access';

-- Down Migration

drop schema if exists core cascade;
