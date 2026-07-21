-- Up Migration
-- 3.11 audit_log (04-database-design §3.11) — schema `audit`, INSERT-only.

create schema audit;

create table audit.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid, actor_role text,
  action text not null, resource text not null, resource_id text,
  reason text,                                    -- mandatory for PII reads
  before jsonb, after jsonb,
  ip inet, at timestamptz not null default now(),
  prev_hash text, row_hash text not null          -- tamper-evident chain (05-master-db §4.5)
);
revoke update, delete on audit.audit_log from public;
comment on table audit.audit_log is 'PC-10/AC-07 — immutable, hash-chained';

-- SPEC-GAP: 05-master-database-architecture §4 point 5 asserts a
-- "pgaudit-style periodic hash chain (prev_hash column)" without specifying
-- the algorithm, and 04-database-design §5's own core.admin_read_customer
-- sample INSERT never sets row_hash even though it is NOT NULL. Least-
-- surprising reading: compute the chain automatically in a BEFORE INSERT
-- trigger so every writer (including core.admin_read_customer) gets a valid
-- row for free. AC-07 (S18, full audit-log hardening) owns extending/
-- replacing this algorithm.
create function audit.compute_row_hash() returns trigger
language plpgsql as $$
declare v_prev text;
begin
  select row_hash into v_prev from audit.audit_log order by id desc limit 1;
  new.prev_hash := v_prev;
  new.row_hash := encode(
    digest(
      coalesce(v_prev, '') || '|' || coalesce(new.actor_id::text, '') || '|' ||
      coalesce(new.actor_role, '') || '|' || new.action || '|' || new.resource || '|' ||
      coalesce(new.resource_id, '') || '|' || coalesce(new.reason, '') || '|' || new.at::text,
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;
comment on function audit.compute_row_hash() is
  'PC-10/AC-07 — SPEC-GAP (see table comment context): SHA-256(prev_hash || '
  'key fields) chain, auto-populated so callers never set row_hash/prev_hash '
  'directly.';

create trigger audit_log_hash_chain before insert on audit.audit_log
  for each row execute function audit.compute_row_hash();

-- Down Migration

drop trigger if exists audit_log_hash_chain on audit.audit_log;
drop function if exists audit.compute_row_hash();
drop schema if exists audit cascade;
