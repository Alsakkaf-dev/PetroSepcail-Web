-- Up Migration
-- 04-database-design §4 (RLS policies) + 05-master-database-architecture §4
-- (RLS strategy). "enable + force row level security" on every table in
-- every schema, no exceptions (§4.1 point 1); policies reference only frozen
-- JWT claims + row state (§4.2); admin PII path is SECURITY DEFINER-only
-- (§4.4, wired in 0007_functions.sql).
--
-- Schema usage: app_user is the one RLS-bound role for all API traffic;
-- app_service_role bypasses RLS (BYPASSRLS) for workers (0003_app_roles.sql).
grant usage on schema core to app_user, app_service_role;
grant usage on schema audit to app_service_role;
grant usage on schema app_auth to app_user, app_service_role;

-- ---------------------------------------------------------------------------
-- core.identities
-- ---------------------------------------------------------------------------
alter table core.identities enable row level security;
alter table core.identities force row level security;

-- Self-service read/update of own identity (04-database-design §4
-- "Customer PII: RU own"). Admin PII read is core.admin_read_customer only —
-- no direct table policy grants it (§4, §5).
create policy identity_self_rw on core.identities
  for all using (id = (app_auth.jwt()->>'sub')::uuid)
           with check (id = (app_auth.jwt()->>'sub')::uuid);

grant select, insert, update, delete on core.identities to app_user;

-- ---------------------------------------------------------------------------
-- core.role_grants — self-read only; writes are system/admin flows only
-- (registration in PC-AUTH-2/S02, admin grant in AC-06/S09), never a
-- direct end-user RLS write path (no self-service role escalation).
-- ---------------------------------------------------------------------------
alter table core.role_grants enable row level security;
alter table core.role_grants force row level security;

create policy role_grants_self_read on core.role_grants
  for select using (identity_id = (app_auth.jwt()->>'sub')::uuid);

grant select on core.role_grants to app_user;

-- ---------------------------------------------------------------------------
-- core.auth_tokens / core.mfa_secrets / core.verification_tokens
-- No end-user policies: auth_tokens is explicit in the spec ("no end-user
-- policies; only app_service_role"); mfa_secrets/verification_tokens hold raw
-- TOTP secrets and single-use token hashes, the same class of secret, so the
-- same rule applies (least-surprising reading — never expose these to a
-- client-facing query path). RLS enabled+forced with zero policies is
-- default-deny for app_user; app_user gets no table GRANT either
-- (defense-in-depth, not relying on RLS alone).
-- ---------------------------------------------------------------------------
alter table core.auth_tokens enable row level security;
alter table core.auth_tokens force row level security;

alter table core.mfa_secrets enable row level security;
alter table core.mfa_secrets force row level security;

alter table core.verification_tokens enable row level security;
alter table core.verification_tokens force row level security;

-- ---------------------------------------------------------------------------
-- core.addresses
-- ---------------------------------------------------------------------------
alter table core.addresses enable row level security;
alter table core.addresses force row level security;

create policy addr_own on core.addresses           -- "Customer address book: CRUD own"
  for all using (identity_id = (app_auth.jwt()->>'sub')::uuid)
           with check (identity_id = (app_auth.jwt()->>'sub')::uuid);

-- DEFERRED (SPEC-GAP, sequencing not a doc defect): 04-database-design §4
-- also ships `addr_driver_active`, letting a driver read the recipient
-- contact of an address while an active task references it, via a join to
-- delivery.delivery_tasks. That table does not exist until S10/S11 (DL
-- schema). DL must add this policy in its own migration once
-- delivery.delivery_tasks exists — it cannot be created here.

grant select, insert, update, delete on core.addresses to app_user;

-- ---------------------------------------------------------------------------
-- core.consents — append-only PDPL log: self select/insert, no update/delete.
-- ---------------------------------------------------------------------------
alter table core.consents enable row level security;
alter table core.consents force row level security;

create policy consents_self_select on core.consents
  for select using (identity_id = (app_auth.jwt()->>'sub')::uuid);
create policy consents_self_insert on core.consents
  for insert with check (identity_id = (app_auth.jwt()->>'sub')::uuid);

grant select, insert on core.consents to app_user;

-- ---------------------------------------------------------------------------
-- core.outbox — no end-user policies (spec explicit: app_service_role only).
-- ---------------------------------------------------------------------------
alter table core.outbox enable row level security;
alter table core.outbox force row level security;

-- ---------------------------------------------------------------------------
-- core.notifications / core.notification_log
-- ---------------------------------------------------------------------------
alter table core.notifications enable row level security;
alter table core.notifications force row level security;

create policy notif_own on core.notifications
  for select using (identity_id = (app_auth.jwt()->>'sub')::uuid);

grant select on core.notifications to app_user;

alter table core.notification_log enable row level security;
alter table core.notification_log force row level security;
-- No end-user policies: internal delivery-attempt log, app_service_role only.

-- ---------------------------------------------------------------------------
-- core.i18n_strings — world-readable (public UI strings, no PII).
-- ---------------------------------------------------------------------------
alter table core.i18n_strings enable row level security;
alter table core.i18n_strings force row level security;

create policy i18n_public_read on core.i18n_strings
  for select using (true);

grant select on core.i18n_strings to app_user;

-- ---------------------------------------------------------------------------
-- core.settings / core.feature_flags — admin-only read at the DB layer;
-- reference values consumed by business logic run server-side via
-- app_service_role (e.g. checkout VAT calc), not fetched raw by the browser.
-- ---------------------------------------------------------------------------
alter table core.settings enable row level security;
alter table core.settings force row level security;

create policy settings_admin_read on core.settings for select
  using (app_auth.jwt()->>'role' in ('admin','super_admin'));

grant select on core.settings to app_user;

alter table core.feature_flags enable row level security;
alter table core.feature_flags force row level security;

create policy feature_flags_admin_read on core.feature_flags for select
  using (app_auth.jwt()->>'role' in ('admin','super_admin'));

grant select on core.feature_flags to app_user;

-- ---------------------------------------------------------------------------
-- core.media_objects — baseline self-read by uploader; PC-09 (S05) may
-- extend (e.g. public product-image read once catalog exists).
-- ---------------------------------------------------------------------------
alter table core.media_objects enable row level security;
alter table core.media_objects force row level security;

create policy media_self_read on core.media_objects
  for select using (uploaded_by = (app_auth.jwt()->>'sub')::uuid);

grant select on core.media_objects to app_user;

-- ---------------------------------------------------------------------------
-- audit.audit_log — no end-user policies; INSERT only via SECURITY DEFINER
-- functions (0007_functions.sql) or app_service_role; UPDATE/DELETE already
-- revoked from public in 0005.
-- ---------------------------------------------------------------------------
alter table audit.audit_log enable row level security;
alter table audit.audit_log force row level security;

-- ---------------------------------------------------------------------------
-- app_service_role: full bypass-backed access to every table created so far.
-- ---------------------------------------------------------------------------
grant all privileges on all tables in schema core to app_service_role;
grant all privileges on all tables in schema audit to app_service_role;

-- Down Migration

revoke all privileges on all tables in schema audit from app_service_role;
revoke all privileges on all tables in schema core from app_service_role;

alter table audit.audit_log disable row level security;

drop policy if exists media_self_read on core.media_objects;
alter table core.media_objects disable row level security;

drop policy if exists feature_flags_admin_read on core.feature_flags;
alter table core.feature_flags disable row level security;

drop policy if exists settings_admin_read on core.settings;
alter table core.settings disable row level security;

drop policy if exists i18n_public_read on core.i18n_strings;
alter table core.i18n_strings disable row level security;

alter table core.notification_log disable row level security;

drop policy if exists notif_own on core.notifications;
alter table core.notifications disable row level security;

alter table core.outbox disable row level security;

drop policy if exists consents_self_insert on core.consents;
drop policy if exists consents_self_select on core.consents;
alter table core.consents disable row level security;

drop policy if exists addr_own on core.addresses;
alter table core.addresses disable row level security;

alter table core.verification_tokens disable row level security;
alter table core.mfa_secrets disable row level security;
alter table core.auth_tokens disable row level security;

drop policy if exists role_grants_self_read on core.role_grants;
alter table core.role_grants disable row level security;

drop policy if exists identity_self_rw on core.identities;
alter table core.identities disable row level security;

revoke usage on schema app_auth from app_user, app_service_role;
revoke usage on schema audit from app_service_role;
revoke usage on schema core from app_user, app_service_role;
