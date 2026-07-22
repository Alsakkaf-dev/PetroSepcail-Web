-- Up Migration
-- PC-06 (S05): S01's `notif_own` policy (0006_rls_policies.sql) was
-- literally "for select" only, matching 04-database-design §4's given
-- sample verbatim. FR-PC06-003 ("unread counts, mark-read, and pagination
-- are provided") needs the owner to be able to flip read_at — adding the
-- missing UPDATE policy now that PC-06 actually builds the mark-read
-- endpoints (EP-PC-021/022). Scoped to read_at only would need a column-
-- level grant, which RLS policies don't do — the WITH CHECK still pins the
-- row to the same owner, so the identity_id can't be changed either way.

create policy notif_own_update on core.notifications
  for update using (identity_id = (app_auth.jwt()->>'sub')::uuid)
             with check (identity_id = (app_auth.jwt()->>'sub')::uuid);

grant update on core.notifications to app_user;

-- Down Migration

revoke update on core.notifications from app_user;
drop policy if exists notif_own_update on core.notifications;
