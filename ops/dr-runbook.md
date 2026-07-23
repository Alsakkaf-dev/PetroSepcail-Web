# Disaster Recovery Runbook (PC-11, TC-PC11-003/FR-PC11-004)
**v2.0 — rewritten under D-15 (hosting/vendor pivot, 2026-07-23).** The T1
Docker-era version of this runbook (`pg_dump`/`minio-mirror-backup.mjs`/
`docker compose exec`/`curl https://localhost`) is preserved in git history —
see the commit that replaced it with this one. Everything below assumes the
D-15 managed-vendor stack: Neon/Vercel Postgres (ADR-15), Pusher Channels
(ADR-16), Vercel Blob (ADR-17), Vercel Cron + QStash (ADR-18), Google Maps
Platform (ADR-19), Resend (ADR-20), Vercel hosting (ADR-21).

Scope note (load-bearing — read first): `00-master/09-deployment-and-infrastructure.md
§6/§7` is the authority this runbook implements. Neon's own Point-in-Time
Recovery (PITR) replaces the old self-hosted `pg_dump` + WAL-archive
mechanism entirely — there is no local dump file and no `wal-archive/`
folder anymore. A timed RPO/RTO drill against Neon PITR is still an
operator exercise (not scripted in this repo), same as it was pre-pivot.

This is the top-level `ops/` **docs** directory — distinct from the `ops`
Postgres **schema** (`ops.incidents`, migration `0017`). Same name,
different namespace, no collision.

## When to use this runbook

- A PC-10 S1/S2 incident is open in `ops.incidents` for the API or
  realtime path and does not self-resolve (the health-watcher logic that
  used to poll containers every 30s no longer applies as-is post-pivot —
  see the "Known gaps" note below on this specific piece of follow-up work).
- The Neon project shows data loss, corruption, or a bad migration that
  needs rolling back to a prior point in time.
- Vercel Blob objects are missing or corrupted for a bucket-equivalent
  (media / invoices / POD photos).
- A manual disaster-recovery drill is being run to validate this procedure
  still works (recommended on a regular cadence, and before any major
  vendor-config change).

## 1. Restore the database (Neon PITR)

1. Open the Neon project console (or the Vercel integration's Neon panel)
   for the affected environment (Preview branches are themselves cheap and
   disposable — for a Preview-only problem, the fastest fix is usually just
   deleting and recreating the branch, not a PITR restore).
2. Neon retains continuous history for the plan's retention window (confirm
   the current window in the Neon dashboard — it varies by plan tier and is
   a real free-tier ceiling worth watching, per RSK-019).
3. Use Neon's **restore to a point in time** action (console, or the Neon
   API/CLI) and pick the timestamp just before the bad write/migration. This
   creates a new branch at that point in time — it does not silently
   overwrite the current branch.
4. Verify the restored branch before cutting over: run
   `npm run db:verify-restore` (unchanged assertions from the T1-era drill
   script, repointed at the restored branch's `DATABASE_URL` — `core`/
   `audit`/`ops` schemas present, `pgmigrations` has rows, `core.identities`
   has the seeded roles).
5. Cut over by updating the environment's `DATABASE_URL` (and `DIRECT_URL`)
   Vercel Environment Variable to the restored branch's connection string,
   then redeploy (§3 below) so the running app picks it up.
6. Once confirmed healthy, the old (bad) branch can be kept briefly for
   forensics and deleted once no longer needed — Neon branches are not free
   to leave around indefinitely on most plans.

## 2. Restore Vercel Blob (media / invoices / POD photos)

1. Vercel Blob has no built-in point-in-time restore — this is the one
   place D-15 traded away a capability the self-hosted MinIO setup had
   (continuous local mirror backups). The mitigation: a periodic export job
   (PC-11's Vercel Cron/QStash task) copies the object list + a snapshot of
   each blob to a separate long-term store on the same cadence the old
   `backup:minio` script ran.
2. To restore: run `npm run backup:blob -- --restore` (repointed at the
   export snapshot's storage location) — re-uploads any object missing from
   the live Blob store. Same one-way additive semantics as the old MinIO
   mirror script (does not delete objects that exist live but not in the
   snapshot).
3. If no recent export snapshot exists, treat that gap itself as a finding —
   see "Known gaps" below; this is real follow-up engineering, not yet
   built as of the D-15 pivot.

## 3. Redeploy the stack

1. There is no `docker compose up -d` step anymore. A "redeploy" is: push
   to the branch Vercel is watching (Production: `main`; Preview: the
   feature branch), or re-run the last successful deployment from the
   Vercel dashboard/CLI (`vercel --prod` for Production).
2. Confirm the deployment is healthy in the Vercel dashboard (Deployments
   tab — build succeeded, no runtime errors on the function logs) instead
   of `docker compose ps`.

## 4. Verify health

1. `curl https://<the environment's URL>/api/v1/ready` — expect
   `{"db":true,"storage":true,"realtime":true}` (all three, per PC-10's
   readiness contract — `storage` now checks Vercel Blob and `realtime`
   now checks Pusher's API instead of a local container).
2. `curl https://<the environment's URL>/api/v1/health` — expect
   `{"status":"ok"}`.
3. Check Vercel's built-in observability (Logs + Analytics tabs, PC-10) for
   the same signal the old Grafana panels showed (p95 latency, auth-failure
   rate, event-dispatch lag) instead of opening a self-hosted Grafana.
4. Confirm the `ops.incidents` row that triggered this runbook (if any)
   transitions to `resolved_at` set once the next health-check cycle sees
   the service healthy again.

## Known gaps (documented, not silently skipped)

- **The health-watcher that used to poll Docker containers every 30s
  (`workers/src/healthWatcher.ts`) has not yet been re-architected for the
  Vercel-native world.** This is real follow-up engineering flagged
  repeatedly elsewhere in this pivot (07-technology-stack-decision.md v5.0
  ADR-21 consequences, 09-deployment-and-infrastructure.md v5.0 §7,
  PROGRESS.md D-15, MASTER-ROADMAP.md's resolved-hold note) — not something
  this documentation rewrite implements. Until it exists, incident detection
  relies on Vercel's own function-error surfacing plus manual checks against
  §4 above.
- **No Vercel Blob export/snapshot job exists yet** (§2.1 above describes
  the intended replacement for the old MinIO mirror backup, not a built
  script). Building it is in scope for the same follow-up session that
  migrates `services/api`/`services/realtime`/`services/zatca-sim`/`workers/`
  into Vercel route handlers.
- The timed RPO/RTO drill (actually measuring wall-clock recovery time via
  Neon PITR against real production-scale data) remains an operator
  exercise, not automated by any script in this repo — same status as
  pre-pivot, just against a different restore mechanism.
- Multi-vendor free-tier ceilings (Neon storage/compute, Pusher connection
  count, Vercel Blob storage, QStash message volume) are a standing risk
  across all of this (RSK-019) — a redeployment during an incident can
  itself be blocked by a ceiling already being hit. Check vendor dashboards
  for quota status as part of any live incident, not just after the fact.
