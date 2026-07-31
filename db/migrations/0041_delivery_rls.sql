-- Up Migration
-- 20-delivery-logistics/04-database-design.md §4 (Task DL-DB-3) — adapted
-- from the doc's `auth.jwt()` (Supabase-era draft) to this project's actual
-- self-built `app_auth.jwt()` (0001_core_extensions.sql, S01), same
-- adaptation every other *_rls.sql migration in this repo already makes.
-- RLS + explicit grants both required (app_user has no implicit access,
-- 0027's own precedent).
grant usage on schema delivery to app_user, app_service_role;

-- ---------------------------------------------------------------------------
-- delivery.drivers — own read only; admin CRUD is AC (04-roles §3 "Driver
-- profiles & KPIs"), via app_service_role, not a broad policy here.
-- ---------------------------------------------------------------------------
alter table delivery.drivers enable row level security;
alter table delivery.drivers force row level security;
create policy driver_self_read on delivery.drivers
  for select using (id = (app_auth.jwt()->>'driver_id')::uuid);
grant select on delivery.drivers to app_user;

-- ---------------------------------------------------------------------------
-- delivery.vans — no end-user policy (internal fleet data, same posture as
-- catalog.stock_locations); admin/dispatch reads via app_service_role.
-- ---------------------------------------------------------------------------
alter table delivery.vans enable row level security;
alter table delivery.vans force row level security;

-- ---------------------------------------------------------------------------
-- delivery.shifts — driver R/U own.
-- ---------------------------------------------------------------------------
alter table delivery.shifts enable row level security;
alter table delivery.shifts force row level security;
create policy shift_own on delivery.shifts
  for all using (driver_id = (app_auth.jwt()->>'driver_id')::uuid)
           with check (driver_id = (app_auth.jwt()->>'driver_id')::uuid);
grant select, insert, update on delivery.shifts to app_user;

-- ---------------------------------------------------------------------------
-- delivery.delivery_tasks — driver R/U own (status transitions via the
-- SECURITY DEFINER functions in 0042, not a direct client UPDATE); customer/
-- supplier R via own-order tracking. Driver sees address+lines but NEVER
-- price (04-roles §3) — price lives on orders.order_lines, not here.
-- ---------------------------------------------------------------------------
alter table delivery.delivery_tasks enable row level security;
alter table delivery.delivery_tasks force row level security;
create policy task_driver_rw on delivery.delivery_tasks
  for all using (driver_id = (app_auth.jwt()->>'driver_id')::uuid)
           with check (driver_id = (app_auth.jwt()->>'driver_id')::uuid);
create policy task_owner_read on delivery.delivery_tasks
  for select using (exists (select 1 from orders.orders o
                            where o.id = order_id and o.user_id = (app_auth.jwt()->>'sub')::uuid));
grant select, update on delivery.delivery_tasks to app_user;

-- ---------------------------------------------------------------------------
-- delivery.task_events — no direct end-user write policy (written only by
-- the SECURITY DEFINER transition functions in 0042); owner/driver may read
-- their own task's history.
-- ---------------------------------------------------------------------------
alter table delivery.task_events enable row level security;
alter table delivery.task_events force row level security;
create policy task_event_read on delivery.task_events
  for select using (exists (
    select 1 from delivery.delivery_tasks t left join orders.orders o on o.id = t.order_id
    where t.id = task_id and (t.driver_id = (app_auth.jwt()->>'driver_id')::uuid
                            or o.user_id = (app_auth.jwt()->>'sub')::uuid)));
grant select on delivery.task_events to app_user;

-- ---------------------------------------------------------------------------
-- delivery.location_pings (DL-03, S11) — driver C own; owner R only while
-- their order is en_route (state-scoped).
-- ---------------------------------------------------------------------------
alter table delivery.location_pings enable row level security;
alter table delivery.location_pings force row level security;
create policy ping_driver_write on delivery.location_pings
  for insert with check (driver_id = (app_auth.jwt()->>'driver_id')::uuid);
create policy ping_owner_live on delivery.location_pings
  for select using (exists (
    select 1 from delivery.delivery_tasks t join orders.orders o on o.id = t.order_id
    where t.id = task_id and o.user_id = (app_auth.jwt()->>'sub')::uuid and t.status = 'en_route'));
grant select, insert on delivery.location_pings to app_user;

-- ---------------------------------------------------------------------------
-- delivery.pods (DL-05, S12) — driver C own task; owner R own order.
-- ---------------------------------------------------------------------------
alter table delivery.pods enable row level security;
alter table delivery.pods force row level security;
create policy pod_owner_read on delivery.pods
  for select using (exists (select 1 from delivery.delivery_tasks t join orders.orders o on o.id=t.order_id
                            where t.id = task_id and o.user_id = (app_auth.jwt()->>'sub')::uuid));
create policy pod_driver_write on delivery.pods
  for insert with check (exists (select 1 from delivery.delivery_tasks t
                                 where t.id = task_id and t.driver_id = (app_auth.jwt()->>'driver_id')::uuid));
grant select, insert on delivery.pods to app_user;

-- ---------------------------------------------------------------------------
-- delivery.driver_cash_custody (DL-05/07, S11/S12) — driver reads OWN
-- balance only; writes are SECURITY DEFINER-only (custody functions land
-- with S11/S12's DL-05/07 work, not this session).
-- ---------------------------------------------------------------------------
alter table delivery.driver_cash_custody enable row level security;
alter table delivery.driver_cash_custody force row level security;
create policy custody_driver_read on delivery.driver_cash_custody
  for select using (driver_id = (app_auth.jwt()->>'driver_id')::uuid);
grant select on delivery.driver_cash_custody to app_user;

-- ---------------------------------------------------------------------------
-- delivery.audit_schedules / stock_audits (DL-06, S12) — config is admin;
-- driver reads own audits.
-- ---------------------------------------------------------------------------
alter table delivery.audit_schedules enable row level security;
alter table delivery.audit_schedules force row level security;
create policy audit_sched_admin on delivery.audit_schedules for select
  using (app_auth.jwt()->>'role' in ('admin','super_admin'));
grant select on delivery.audit_schedules to app_user;

alter table delivery.stock_audits enable row level security;
alter table delivery.stock_audits force row level security;
create policy audit_driver_read on delivery.stock_audits for select
  using ((entity_kind='driver' and entity_id = (app_auth.jwt()->>'driver_id')::uuid)
      or app_auth.jwt()->>'role' in ('admin','super_admin'));
grant select on delivery.stock_audits to app_user;

grant all privileges on all tables in schema delivery to app_service_role;

-- Down Migration

revoke all privileges on all tables in schema delivery from app_service_role;

revoke select on delivery.stock_audits from app_user;
drop policy if exists audit_driver_read on delivery.stock_audits;
alter table delivery.stock_audits disable row level security;

revoke select on delivery.audit_schedules from app_user;
drop policy if exists audit_sched_admin on delivery.audit_schedules;
alter table delivery.audit_schedules disable row level security;

revoke select on delivery.driver_cash_custody from app_user;
drop policy if exists custody_driver_read on delivery.driver_cash_custody;
alter table delivery.driver_cash_custody disable row level security;

revoke select, insert on delivery.pods from app_user;
drop policy if exists pod_driver_write on delivery.pods;
drop policy if exists pod_owner_read on delivery.pods;
alter table delivery.pods disable row level security;

revoke select, insert on delivery.location_pings from app_user;
drop policy if exists ping_owner_live on delivery.location_pings;
drop policy if exists ping_driver_write on delivery.location_pings;
alter table delivery.location_pings disable row level security;

revoke select on delivery.task_events from app_user;
drop policy if exists task_event_read on delivery.task_events;
alter table delivery.task_events disable row level security;

revoke select, update on delivery.delivery_tasks from app_user;
drop policy if exists task_owner_read on delivery.delivery_tasks;
drop policy if exists task_driver_rw on delivery.delivery_tasks;
alter table delivery.delivery_tasks disable row level security;

revoke select, insert, update on delivery.shifts from app_user;
drop policy if exists shift_own on delivery.shifts;
alter table delivery.shifts disable row level security;

alter table delivery.vans disable row level security;

revoke select on delivery.drivers from app_user;
drop policy if exists driver_self_read on delivery.drivers;
alter table delivery.drivers disable row level security;

revoke usage on schema delivery from app_user, app_service_role;
