-- Up Migration
-- PC-09 (S05): EP-PC-051's own text — "authorized by ownership/role"
-- (05-api-specification.md §6) — needs admin/super_admin to read any
-- media_objects row, not just the uploader. S01's `media_self_read` policy
-- (0006_rls_policies.sql) only covered the uploader; this adds the missing
-- admin/super_admin branch as a second, additive policy (RLS policies OR
-- together, so this doesn't touch `media_self_read` at all).

create policy media_admin_read on core.media_objects
  for select using (app_auth.jwt()->>'role' in ('admin', 'super_admin'));

-- Down Migration

drop policy if exists media_admin_read on core.media_objects;
