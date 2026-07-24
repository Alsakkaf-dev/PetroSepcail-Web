-- Up Migration
-- SF-10 FR-SF10-005: "Notification preferences per channel/type; in-app
-- always on." `in_app` is deliberately NOT a selectable channel in this
-- table (a customer can never turn off in-app notifications) — only the
-- three PC-06 channels that make sense to opt in/out of per D-04's
-- `notification_channel` enum (0002_enum_types.sql: in_app|email|web_push|sms).
-- `notification_type` stays free text, matching core.notifications.type's
-- own convention (no local enum there either).
create table core.notification_preferences (
  identity_id       uuid not null references core.identities(id) on delete cascade,
  notification_type text not null,
  channel           notification_channel not null check (channel <> 'in_app'),
  enabled           boolean not null default true,
  updated_at        timestamptz not null default now(),
  primary key (identity_id, notification_type, channel)
);
comment on table core.notification_preferences is 'SF-10 FR-SF10-005 — per type/channel opt-out; absent row = enabled (default-on)';
create trigger set_updated_at before update on core.notification_preferences
  for each row execute function moddatetime(updated_at);

grant usage on schema core to app_user, app_service_role; -- already granted (0006) — kept for readability, no-op if present

alter table core.notification_preferences enable row level security;
alter table core.notification_preferences force row level security;
create policy notification_preferences_own on core.notification_preferences
  for all using (identity_id = (app_auth.jwt()->>'sub')::uuid)
           with check (identity_id = (app_auth.jwt()->>'sub')::uuid);
grant select, insert, update, delete on core.notification_preferences to app_user;
grant all privileges on core.notification_preferences to app_service_role;

-- Down Migration

revoke all privileges on core.notification_preferences from app_service_role;
revoke select, insert, update, delete on core.notification_preferences from app_user;
drop policy if exists notification_preferences_own on core.notification_preferences;
alter table core.notification_preferences disable row level security;
drop table if exists core.notification_preferences;
