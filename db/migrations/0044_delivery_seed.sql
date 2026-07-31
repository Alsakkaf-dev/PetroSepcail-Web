-- Up Migration
-- 04-database-design.md §7 seed instructions + the roadmap's own S10 Out
-- clause ("staged order auto-assigns to seeded driver"). Backfills
-- core.role_grants.driver_id for the seed driver identity 0008_seed.sql
-- deliberately left null ("delivery.drivers (S10/S11) doesn't exist yet —
-- those sessions backfill"). Seed van_stock is a direct INSERT, not routed
-- through catalog.record_stock_movement — seed data bypassing the normal
-- transactional path is the same precedent 0008_seed.sql itself already
-- sets for core.identities (direct INSERT, not through the register/auth
-- flow); it also avoids depending on hub inventory being non-zero for every
-- pack size at migration time.
insert into delivery.vans (id, plate, capacity_liters)
values ('00000000-0000-0000-0000-00000000f001', 'SEED-VAN-1', 500.00);

insert into catalog.stock_locations (kind, name_ar, name_en, van_id)
values ('van', 'فان التوصيل التجريبي', 'Seed Delivery Van', '00000000-0000-0000-0000-00000000f001');

insert into delivery.drivers (id, identity_id, vehicle_desc, status)
values ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-000000000003', 'White pickup, seed fleet', 'active');

update delivery.drivers set default_van_id = '00000000-0000-0000-0000-00000000f001'
  where id = '00000000-0000-0000-0000-00000000f002';

update core.role_grants set driver_id = '00000000-0000-0000-0000-00000000f002'
  where identity_id = '00000000-0000-0000-0000-000000000003' and role = 'driver';

insert into delivery.shifts (driver_id, van_id, status, available, opening_stock)
values ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-00000000f001', 'open', true, '{}'::jsonb);

-- Load every active pack size onto the seed van at a flat demo quantity so
-- DL-01's stock-coverage eligibility gate can pass for any real order,
-- regardless of which SKUs it contains.
insert into catalog.van_stock (location_id, pack_size_id, qty)
select l.id, p.id, 20
from catalog.stock_locations l
cross join catalog.pack_sizes p
where l.van_id = '00000000-0000-0000-0000-00000000f001' and p.is_active;

-- Down Migration

delete from catalog.van_stock where location_id in (
  select id from catalog.stock_locations where van_id = '00000000-0000-0000-0000-00000000f001'
);
delete from delivery.shifts where driver_id = '00000000-0000-0000-0000-00000000f002';
update core.role_grants set driver_id = null
  where identity_id = '00000000-0000-0000-0000-000000000003' and role = 'driver';
delete from delivery.drivers where id = '00000000-0000-0000-0000-00000000f002';
delete from catalog.stock_locations where van_id = '00000000-0000-0000-0000-00000000f001';
delete from delivery.vans where id = '00000000-0000-0000-0000-00000000f001';
