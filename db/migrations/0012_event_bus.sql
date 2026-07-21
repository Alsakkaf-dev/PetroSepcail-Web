-- Up Migration
-- PC-EV-1 (S04): the NOTIFY trigger 04-database-design §3.7 flagged as
-- "wired in S04" when core.outbox was created (S01, 0004_core_schema.sql).
-- 03-sdd.md §5 sequence: "DB-->>D: NOTIFY 'outbox'" on every insert.

create function core.notify_outbox() returns trigger
language plpgsql as $$
begin
  perform pg_notify('outbox', new.event_id::text);
  return new;
end;
$$;

create trigger outbox_notify after insert on core.outbox
  for each row execute function core.notify_outbox();

-- PC-EV-4: per-consumer idempotency (03-sdd.md §5: "K->>DB: SELECT 1 FROM
-- processed WHERE event_id?"). Composite PK, not a single global flag —
-- multiple independent consumers (e.g. PC-06 welcome-email AND LE-04
-- eligibility-check both consume EV-PC-001) each need their own dedupe
-- record for the same event_id (NFR-PC-009).
create table core.processed_events (
  consumer_name text not null,
  event_id uuid not null,
  processed_at timestamptz not null default now(),
  primary key (consumer_name, event_id)
);
comment on table core.processed_events is 'PC-05 — per-consumer idempotency ledger for at-least-once event delivery';

alter table core.processed_events enable row level security;
alter table core.processed_events force row level security;
-- No end-user policies: internal dispatcher/consumer bookkeeping, service_role only.

grant select, insert on core.processed_events to service_role;

-- Down Migration

revoke select, insert on core.processed_events from service_role;
drop table if exists core.processed_events;
drop trigger if exists outbox_notify on core.outbox;
drop function if exists core.notify_outbox();
