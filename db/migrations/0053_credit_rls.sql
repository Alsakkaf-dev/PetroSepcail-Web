-- Up Migration
-- 30-supplier-portal/04-database-design.md §4 (Task SP-DB-3, RLS half) —
-- adapted from the doc's `auth.jwt()` draft to this project's real
-- `app_auth.jwt()`, same standing adaptation every RLS migration here makes.
grant usage on schema credit to app_user, app_service_role;

alter table credit.suppliers enable row level security;
alter table credit.suppliers force row level security;
create policy supplier_self_read on credit.suppliers
  for select using (id = (app_auth.jwt()->>'supplier_id')::uuid);
-- Contact/bank fields only, not tier/limit — enforced in update_supplier_profile (0054), not a broad UPDATE policy
-- here (same "no broad write policy, SECURITY DEFINER only" posture credit.invoices/custody_ledger already use).
grant select on credit.suppliers to app_user;

alter table credit.credit_limits enable row level security;
alter table credit.credit_limits force row level security;
create policy limit_supplier_read on credit.credit_limits
  for select using (supplier_id = (app_auth.jwt()->>'supplier_id')::uuid and is_current);
grant select on credit.credit_limits to app_user;

alter table credit.invoices enable row level security;
alter table credit.invoices force row level security;
create policy invoice_supplier_read on credit.invoices
  for select using (supplier_id = (app_auth.jwt()->>'supplier_id')::uuid);
grant select on credit.invoices to app_user;

alter table credit.invoice_lines enable row level security;
alter table credit.invoice_lines force row level security;
create policy invoice_line_read on credit.invoice_lines
  for select using (exists (select 1 from credit.invoices i
                            where i.id = invoice_id and i.supplier_id = (app_auth.jwt()->>'supplier_id')::uuid));
grant select on credit.invoice_lines to app_user;

alter table credit.payments_received enable row level security;
alter table credit.payments_received force row level security;
create policy payment_supplier_read on credit.payments_received
  for select using (supplier_id = (app_auth.jwt()->>'supplier_id')::uuid);
grant select on credit.payments_received to app_user;

alter table credit.credit_notes enable row level security;
alter table credit.credit_notes force row level security;
create policy credit_note_supplier_read on credit.credit_notes
  for select using (supplier_id = (app_auth.jwt()->>'supplier_id')::uuid);
grant select on credit.credit_notes to app_user;

alter table credit.custody_ledger enable row level security;
alter table credit.custody_ledger force row level security;
create policy custody_supplier_read on credit.custody_ledger
  for select using (supplier_id = (app_auth.jwt()->>'supplier_id')::uuid);
grant select on credit.custody_ledger to app_user;

alter table credit.order_templates enable row level security;
alter table credit.order_templates force row level security;
create policy template_own on credit.order_templates
  for all using (supplier_id = (app_auth.jwt()->>'supplier_id')::uuid)
           with check (supplier_id = (app_auth.jwt()->>'supplier_id')::uuid);
grant select, insert, update, delete on credit.order_templates to app_user;

alter table credit.statements enable row level security;
alter table credit.statements force row level security;
create policy statement_supplier_read on credit.statements
  for select using (supplier_id = (app_auth.jwt()->>'supplier_id')::uuid);
grant select on credit.statements to app_user;

-- catalog.tier_prices: supplier reads ONLY their own tier; admin reads all; customer/public never (NFR-SP-003).
alter table catalog.tier_prices enable row level security;
alter table catalog.tier_prices force row level security;
create policy tier_price_supplier_read on catalog.tier_prices
  for select using (
    app_auth.jwt()->>'role' in ('admin','super_admin')
    or (app_auth.jwt()->>'role' = 'supplier'
        and tier = (select s.tier from credit.suppliers s where s.id = (app_auth.jwt()->>'supplier_id')::uuid)));
grant select on catalog.tier_prices to app_user;

grant all privileges on all tables in schema credit to app_service_role;
grant all privileges on catalog.tier_prices to app_service_role;

-- Down Migration

revoke all privileges on catalog.tier_prices from app_service_role;
revoke all privileges on all tables in schema credit from app_service_role;

revoke select on catalog.tier_prices from app_user;
drop policy if exists tier_price_supplier_read on catalog.tier_prices;
alter table catalog.tier_prices disable row level security;

revoke select on credit.statements from app_user;
drop policy if exists statement_supplier_read on credit.statements;
alter table credit.statements disable row level security;

revoke select, insert, update, delete on credit.order_templates from app_user;
drop policy if exists template_own on credit.order_templates;
alter table credit.order_templates disable row level security;

revoke select on credit.custody_ledger from app_user;
drop policy if exists custody_supplier_read on credit.custody_ledger;
alter table credit.custody_ledger disable row level security;

revoke select on credit.credit_notes from app_user;
drop policy if exists credit_note_supplier_read on credit.credit_notes;
alter table credit.credit_notes disable row level security;

revoke select on credit.payments_received from app_user;
drop policy if exists payment_supplier_read on credit.payments_received;
alter table credit.payments_received disable row level security;

revoke select on credit.invoice_lines from app_user;
drop policy if exists invoice_line_read on credit.invoice_lines;
alter table credit.invoice_lines disable row level security;

revoke select on credit.invoices from app_user;
drop policy if exists invoice_supplier_read on credit.invoices;
alter table credit.invoices disable row level security;

revoke select on credit.credit_limits from app_user;
drop policy if exists limit_supplier_read on credit.credit_limits;
alter table credit.credit_limits disable row level security;

revoke select on credit.suppliers from app_user;
drop policy if exists supplier_self_read on credit.suppliers;
alter table credit.suppliers disable row level security;

revoke usage on schema credit from app_user, app_service_role;
