-- Up Migration
-- Real bug caught by live verification (S07, docker compose up): SF-01's
-- product-detail page returned an empty `media` array for every SKU even
-- though catalog.sku_media rows and their core.media_objects rows both
-- exist. catalog.sku_media has a public-read policy (0020_catalog_rls.sql),
-- but core.media_objects only had `media_self_read` (uploader) and
-- `media_admin_read` (admin/super_admin) — 0006/0014_rls_policies.sql, both
-- PC-09 policies written before a public-facing media consumer (catalog
-- product photos) existed. A guest's join from sku_media to media_objects
-- therefore returned zero media_objects rows: RLS silently hid the very
-- images FR-SF01-007/TC-SF01-018 requires anyone to see. Additive third
-- policy (RLS policies OR together, same pattern as media_admin_read's own
-- addition) — scoped to `purpose = 'product_image'` only; POD photos,
-- invoices, and transfer proofs stay exactly as restricted as before.
create policy media_product_image_public_read on core.media_objects
  for select using (purpose = 'product_image');

-- Down Migration

drop policy if exists media_product_image_public_read on core.media_objects;
