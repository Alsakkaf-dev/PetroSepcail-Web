-- Up Migration
-- Fix-forward on 0024 (same session, same live-verification pass — caught
-- by re-running the PRE-EXISTING me.e2e.test.ts RLS suite, not a new test):
-- 0024's policy made EVERY core.media_objects row with purpose='product_image'
-- public, but that purpose value is also the generic example S05's own
-- ownership test (me.e2e.test.ts, "a different ... user cannot get a
-- download URL for someone else's object") uses for an ad-hoc, non-catalog
-- upload — which must NOT become world-readable just because it happens to
-- share that purpose string. The real intent (FR-SF01-007/TC-SF01-018) is
-- narrower: only media actually attached to the product catalog (i.e.
-- referenced by catalog.sku_media) should be public. Fixed by scoping the
-- predicate to that join instead of the bare purpose column.
drop policy if exists media_product_image_public_read on core.media_objects;

create policy media_product_image_public_read on core.media_objects
  for select using (exists (select 1 from catalog.sku_media sm where sm.media_id = core.media_objects.id));

-- Down Migration

drop policy if exists media_product_image_public_read on core.media_objects;

create policy media_product_image_public_read on core.media_objects
  for select using (purpose = 'product_image');
