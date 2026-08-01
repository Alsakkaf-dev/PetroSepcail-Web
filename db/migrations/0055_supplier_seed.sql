-- Up Migration
-- 30-supplier-portal S14 resume step 2 (MASTER-ROADMAP.md) — backfills
-- core.role_grants.supplier_id for the seed supplier identity
-- (00000000-0000-0000-0000-000000000002), which 0008_seed.sql deliberately
-- left null ("credit.suppliers (S14) ... doesn't exist yet — those sessions
-- backfill"), same driver_id-backfill precedent 0044 already set. Direct
-- INSERTs, not a call to credit.provision_supplier — that function is
-- SECURITY DEFINER granted only to app_service_role (0054), and 0044's own
-- seed already established direct-INSERT as the seed-data convention rather
-- than routing through the app-facing function.
insert into credit.suppliers (id, identity_id, business_name_ar, business_name_en, tier, status, activated_at)
values (
  '00000000-0000-0000-0000-00000000f003',
  '00000000-0000-0000-0000-000000000002',
  'المورد التجريبي',
  'Seed Supplier',
  'bronze',
  'active',
  now()
);

insert into credit.credit_limits (supplier_id, limit_amount, reason)
values ('00000000-0000-0000-0000-00000000f003', 20000.00, 'initial provisioning default (D-06)');

update core.role_grants set supplier_id = '00000000-0000-0000-0000-00000000f003'
  where identity_id = '00000000-0000-0000-0000-000000000002' and role = 'supplier';

-- Down Migration

update core.role_grants set supplier_id = null
  where identity_id = '00000000-0000-0000-0000-000000000002' and role = 'supplier';
delete from credit.credit_limits where supplier_id = '00000000-0000-0000-0000-00000000f003';
delete from credit.suppliers where id = '00000000-0000-0000-0000-00000000f003';
