-- Up Migration
-- 10-customer-storefront/04-database-design.md §4 (catalog block): public
-- read for every catalog table except inventory (app_service_role-only; the
-- customer-facing boolean comes from catalog.v_sku_availability, granted
-- separately below). AC-02 (S07's admin routes) writes via app_service_role,
-- exactly like PC-12's config writes (0006_rls_policies.sql precedent) — no
-- direct end-user write policy exists on any catalog table (NFR-AC-006 sole
-- writer discipline; FR-AC02-001 "an attempted write from SF/SP is denied by
-- grants/RLS").
grant usage on schema catalog to app_user, app_service_role;

-- ---------------------------------------------------------------------------
-- catalog.brand_families
-- ---------------------------------------------------------------------------
alter table catalog.brand_families enable row level security;
alter table catalog.brand_families force row level security;
create policy fam_public_read on catalog.brand_families for select using (true);  -- 04-roles §3 "Catalog: R"
grant select on catalog.brand_families to app_user;

-- ---------------------------------------------------------------------------
-- catalog.skus
-- ---------------------------------------------------------------------------
alter table catalog.skus enable row level security;
alter table catalog.skus force row level security;
create policy sku_public_read on catalog.skus for select using (true);
grant select on catalog.skus to app_user;

-- ---------------------------------------------------------------------------
-- catalog.sku_content
-- ---------------------------------------------------------------------------
alter table catalog.sku_content enable row level security;
alter table catalog.sku_content force row level security;
create policy sku_content_public_read on catalog.sku_content for select using (true);
grant select on catalog.sku_content to app_user;

-- ---------------------------------------------------------------------------
-- catalog.certifications
-- ---------------------------------------------------------------------------
alter table catalog.certifications enable row level security;
alter table catalog.certifications force row level security;
create policy certifications_public_read on catalog.certifications for select using (true);
grant select on catalog.certifications to app_user;

-- ---------------------------------------------------------------------------
-- catalog.pack_sizes
-- ---------------------------------------------------------------------------
alter table catalog.pack_sizes enable row level security;
alter table catalog.pack_sizes force row level security;
create policy pack_sizes_public_read on catalog.pack_sizes for select using (true);
grant select on catalog.pack_sizes to app_user;

-- ---------------------------------------------------------------------------
-- catalog.prices
-- ---------------------------------------------------------------------------
alter table catalog.prices enable row level security;
alter table catalog.prices force row level security;
create policy prices_public_read on catalog.prices for select using (true);
grant select on catalog.prices to app_user;

-- ---------------------------------------------------------------------------
-- catalog.inventory — NO end-user policy (04-roles §3 "Inventory: R in-stock
-- flag only" => served by catalog.v_sku_availability; base table app_service_role
-- only, matching AC-02's sole-writer discipline). The view is owned by the
-- migration-running role, which is the Postgres superuser in this project's
-- self-hosted images — superusers always bypass RLS regardless of FORCE ROW
-- LEVEL SECURITY, so the view still aggregates across every row for any
-- caller while the base table itself stays fully inaccessible to app_user.
-- ---------------------------------------------------------------------------
alter table catalog.inventory enable row level security;
alter table catalog.inventory force row level security;

grant select on catalog.v_sku_availability to app_user;

-- ---------------------------------------------------------------------------
-- catalog.sku_media
-- ---------------------------------------------------------------------------
alter table catalog.sku_media enable row level security;
alter table catalog.sku_media force row level security;
create policy sku_media_public_read on catalog.sku_media for select using (true);
grant select on catalog.sku_media to app_user;

-- ---------------------------------------------------------------------------
-- app_service_role: full bypass-backed access to every catalog table (AC-02
-- writes, D-14a stock movements) — same closing grant pattern as
-- 0006_rls_policies.sql for schema core/audit.
-- ---------------------------------------------------------------------------
grant all privileges on all tables in schema catalog to app_service_role;

-- Down Migration

revoke all privileges on all tables in schema catalog from app_service_role;

revoke select on catalog.sku_media from app_user;
drop policy if exists sku_media_public_read on catalog.sku_media;
alter table catalog.sku_media disable row level security;

revoke select on catalog.v_sku_availability from app_user;
alter table catalog.inventory disable row level security;

revoke select on catalog.prices from app_user;
drop policy if exists prices_public_read on catalog.prices;
alter table catalog.prices disable row level security;

revoke select on catalog.pack_sizes from app_user;
drop policy if exists pack_sizes_public_read on catalog.pack_sizes;
alter table catalog.pack_sizes disable row level security;

revoke select on catalog.certifications from app_user;
drop policy if exists certifications_public_read on catalog.certifications;
alter table catalog.certifications disable row level security;

revoke select on catalog.sku_content from app_user;
drop policy if exists sku_content_public_read on catalog.sku_content;
alter table catalog.sku_content disable row level security;

revoke select on catalog.skus from app_user;
drop policy if exists sku_public_read on catalog.skus;
alter table catalog.skus disable row level security;

revoke select on catalog.brand_families from app_user;
drop policy if exists fam_public_read on catalog.brand_families;
alter table catalog.brand_families disable row level security;

revoke usage on schema catalog from app_user, app_service_role;
