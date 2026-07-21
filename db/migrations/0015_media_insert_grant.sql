-- Up Migration
-- PC-09 (S05): S01's core.media_objects grant (0006_rls_policies.sql) was
-- SELECT-only ("baseline self-read by uploader") — it didn't anticipate the
-- actual upload-registration write path EP-PC-050 needs (recording the
-- object at presigned-URL-issuance time, routes/media.ts). RLS itself
-- doesn't gate this insert (no INSERT policy exists, so any INSERT that got
-- past the missing GRANT would still need one) — add both.

create policy media_self_insert on core.media_objects
  for insert with check (uploaded_by = (auth.jwt()->>'sub')::uuid);

grant insert on core.media_objects to app_user;

-- Down Migration

revoke insert on core.media_objects from app_user;
drop policy if exists media_self_insert on core.media_objects;
