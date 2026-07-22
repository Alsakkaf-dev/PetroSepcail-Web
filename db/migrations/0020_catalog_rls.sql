-- Up Migration
-- 10-customer-storefront/04-database-design.md §4 (catalog block): public
-- read for every catalog table except inventory (service_role-only; the
-- customer-facing boolean comes from catalog.v_sku_availability, granted
-- separately below). AC-02 (S07's admin routes) writes via service_role,
-- exactly like PC-12's config writes (0006_rls_policies.sql precedent) — no
-- direct end-user write policy exists on any catalog table (NFR-AC-006 sole
-- writer discipline; FR-AC02-001 "an attempted write from SF/SP is denied by
-- grants/RLS").
grant usage on schema catalog to app_user, service_role;

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

-- Down Migration

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

revoke usage on schema catalog from app_user, service_role;
