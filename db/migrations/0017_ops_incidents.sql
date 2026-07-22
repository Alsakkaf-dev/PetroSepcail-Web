-- Up Migration
-- PC-10 (FR-PC10-003/TC-PC10-003): health-driven S1 alerting persists an
-- incident record here so an alert is provably raised (not just logged and
-- forgotten), and so an S1/S2 event that touches customer data has a fixed
-- `pdpl_assessment_due_at` (opened_at + 72h) to measure the PDPL breach-
-- assessment window against. app_service_role only (the health watcher runs as
-- a background worker) — same no-end-user-policy pattern as core.outbox.

create schema ops;

create table ops.incidents (
  id bigint generated always as identity primary key,
  severity text not null check (severity in ('S1', 'S2', 'S3')),
  service text not null,
  message text not null,
  touches_data boolean not null default false,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  pdpl_assessment_due_at timestamptz
);
comment on table ops.incidents is
  'PC-10 — health-driven alerting log; pdpl_assessment_due_at set only when '
  'touches_data is true (opened_at + 72h, FR-PC10-003).';

alter table ops.incidents enable row level security;
alter table ops.incidents force row level security;

grant usage on schema ops to app_service_role;
grant select, insert, update on ops.incidents to app_service_role;
grant usage, select on ops.incidents_id_seq to app_service_role;

-- Down Migration

revoke usage, select on ops.incidents_id_seq from app_service_role;
revoke select, insert, update on ops.incidents from app_service_role;
revoke usage on schema ops from app_service_role;

alter table ops.incidents disable row level security;
drop table ops.incidents;
drop schema ops;
