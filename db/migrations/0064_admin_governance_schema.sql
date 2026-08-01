-- Up Migration
-- 40-admin-center/04-database-design.md §2.2-2.6 (AC-DB-1, S17/S18). The
-- `audit` schema itself + audit_log (0005) already exist; this adds the
-- remaining governance tables that were never built: reason_codes (AC-05),
-- interventions (AC-05), dual_control_approvals (AC-03), pdpl_requests
-- (AC-10), breach_notifications (AC-10). `app_auth.jwt()` throughout, same
-- standing adaptation every RLS-bearing migration in this repo makes.

create table audit.reason_codes (
  code          text primary key,
  label_ar      text not null,
  label_en      text not null,
  requires_note boolean not null default false,
  active        boolean not null default true
);
comment on table audit.reason_codes is 'AC-05 — the fixed intervention reason list; free-text-only reasons rejected';

create table audit.interventions (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references core.identities(id),
  kind        text not null check (kind in ('force_cancel','address_edit','refund_override','failed_delivery','return_decision','review_moderation')),
  order_id    uuid references orders.orders(id) on delete restrict,
  reason_code text not null references audit.reason_codes(code),
  note        text,
  before      jsonb,
  after       jsonb,
  outcome     text not null default 'open' check (outcome in ('open','resolved','rejected')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index on audit.interventions (outcome) where outcome = 'open';
comment on table audit.interventions is 'AC-05 — every intervention is a reason-coded, audited case (FR-AC05-006)';

create table audit.dual_control_approvals (
  id              uuid primary key default gen_random_uuid(),
  request_kind    text not null check (request_kind in ('credit_limit_over_threshold')),
  payload         jsonb not null,
  requested_by    uuid not null references core.identities(id),
  acknowledged_by uuid references core.identities(id),
  status          text not null default 'pending' check (status in ('pending','approved','expired','rejected')),
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  check (acknowledged_by is null or acknowledged_by <> requested_by)
);
comment on table audit.dual_control_approvals is 'AC-03 — > SAR 100,000 credit-limit change needs a second admin ack before commit';

create table audit.pdpl_requests (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null references core.identities(id) on delete restrict,
  kind         text not null check (kind in ('access','correction','deletion')),
  status       text not null default 'received' check (status in ('received','in_grace','executing','completed','rejected')),
  grace_until  date,
  handled_by   uuid references core.identities(id),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
comment on table audit.pdpl_requests is 'AC-10 — PDPL access/correction/deletion; deletion after a grace period, each step audited';

create table audit.breach_notifications (
  id          uuid primary key default gen_random_uuid(),
  detected_at timestamptz not null,
  notify_by   timestamptz not null,
  scope       text not null,
  status      text not null default 'open' check (status in ('open','regulator_notified','subjects_notified','closed')),
  handled_by  uuid references core.identities(id),
  created_at  timestamptz not null default now()
);
comment on table audit.breach_notifications is 'AC-10 — 72-hour PDPL breach-notification obligation tracker';

-- RLS: admin/super_admin surfaces throughout (this schema has no non-admin
-- role in its RLS story at all -- app_service_role's existing blanket grant
-- on all of schema audit, 0006, already covers the write side of every
-- function below; these SELECT/CRUD grants are the app_user/admin-facing
-- read+CRUD side the console/routes need).
alter table audit.reason_codes enable row level security;
alter table audit.reason_codes force row level security;
create policy reason_read on audit.reason_codes for select using (app_auth.jwt()->>'role' in ('admin','super_admin'));
grant select on audit.reason_codes to app_user;

alter table audit.interventions enable row level security;
alter table audit.interventions force row level security;
create policy intervention_admin on audit.interventions for all
  using (app_auth.jwt()->>'role' in ('admin','super_admin'))
  with check (app_auth.jwt()->>'role' in ('admin','super_admin') and actor_id = (app_auth.jwt()->>'sub')::uuid);
grant select, insert, update on audit.interventions to app_user;

alter table audit.dual_control_approvals enable row level security;
alter table audit.dual_control_approvals force row level security;
create policy dca_admin on audit.dual_control_approvals for all
  using (app_auth.jwt()->>'role' in ('admin','super_admin'))
  with check (app_auth.jwt()->>'role' in ('admin','super_admin'));
grant select, insert, update on audit.dual_control_approvals to app_user;

alter table audit.pdpl_requests enable row level security;
alter table audit.pdpl_requests force row level security;
create policy pdpl_admin on audit.pdpl_requests for all
  using (app_auth.jwt()->>'role' in ('admin','super_admin'))
  with check (app_auth.jwt()->>'role' in ('admin','super_admin'));
grant select, insert, update on audit.pdpl_requests to app_user;

alter table audit.breach_notifications enable row level security;
alter table audit.breach_notifications force row level security;
create policy breach_admin on audit.breach_notifications for all
  using (app_auth.jwt()->>'role' in ('admin','super_admin'))
  with check (app_auth.jwt()->>'role' in ('admin','super_admin'));
grant select, insert, update on audit.breach_notifications to app_user;

grant all privileges on audit.reason_codes, audit.interventions, audit.dual_control_approvals, audit.pdpl_requests, audit.breach_notifications to app_service_role;

-- Seed: fixed reason-code list (04-roles §5) + the settings this session's
-- functions/views read (k_anon_floor for AC-01, audit_log_retention_years/
-- pdpl_grace_days for AC-10 — none of these three existed in core.settings
-- yet, checked against 0008_seed.sql's own seed list).
insert into audit.reason_codes (code, label_ar, label_en, requires_note) values
  ('customer_request', 'طلب العميل', 'Customer request', false),
  ('fraud_suspected', 'اشتباه احتيال', 'Fraud suspected', true),
  ('address_unreachable', 'العنوان غير قابل للوصول', 'Address unreachable', false),
  ('stock_unavailable', 'المخزون غير متوفر', 'Stock unavailable', false),
  ('duplicate_order', 'طلب مكرر', 'Duplicate order', false),
  ('payment_issue', 'مشكلة في الدفع', 'Payment issue', true),
  ('quality_complaint', 'شكوى جودة', 'Quality complaint', true),
  ('policy_violation', 'مخالفة سياسة', 'Policy violation', true),
  ('other_with_note', 'أخرى (مع ملاحظة)', 'Other (with note)', true);

insert into core.settings (key, value) values
  ('k_anon_floor', '5'),
  ('audit_log_retention_years', '5'),
  ('pdpl_grace_days', '30');

-- Down Migration

delete from core.settings where key in ('k_anon_floor', 'audit_log_retention_years', 'pdpl_grace_days');
delete from audit.reason_codes;

revoke all privileges on audit.reason_codes, audit.interventions, audit.dual_control_approvals, audit.pdpl_requests, audit.breach_notifications from app_service_role;

revoke select, insert, update on audit.breach_notifications from app_user;
drop policy if exists breach_admin on audit.breach_notifications;
drop table if exists audit.breach_notifications;

revoke select, insert, update on audit.pdpl_requests from app_user;
drop policy if exists pdpl_admin on audit.pdpl_requests;
drop table if exists audit.pdpl_requests;

revoke select, insert, update on audit.dual_control_approvals from app_user;
drop policy if exists dca_admin on audit.dual_control_approvals;
drop table if exists audit.dual_control_approvals;

revoke select, insert, update on audit.interventions from app_user;
drop policy if exists intervention_admin on audit.interventions;
drop table if exists audit.interventions;

revoke select on audit.reason_codes from app_user;
drop policy if exists reason_read on audit.reason_codes;
drop table if exists audit.reason_codes;
