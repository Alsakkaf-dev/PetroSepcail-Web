# Disaster Recovery Runbook (PC-11, TC-PC11-003/FR-PC11-004)

Scope note (load-bearing — read first): `00-master/09-deployment-and-infrastructure.md §6`
scopes T1 backups as `pg_dump` to a local folder; off-site WAL/PITR
replication and a *timed* RPO-drill are explicitly T2/T3 **operational**
tasks, not T1 build tasks. This runbook documents the T1 mechanism (it is
real and live-verified — see S06's Handover Brief) and the manual
recovery procedure an operator runs against it. It does not implement an
automated off-site PITR pipeline; that is T2+ scope.

This is the top-level `ops/` **docs** directory — distinct from the `ops`
Postgres **schema** (`ops.incidents`, migration `0017`). Same name,
different namespace, no collision.

## When to use this runbook

- A PC-10 S1/S2 incident is open in `ops.incidents` for the `api` or
  `realtime` service and does not self-resolve (the health-watcher already
  retries automatically — see `workers/src/healthWatcher.ts` — this runbook
  is for the case where the underlying data/service is actually gone, not
  a transient blip).
- `docker compose ps` shows the `postgres` or `minio` volume/container is
  lost or corrupted.
- A manual disaster-recovery drill is being run to validate this procedure
  still works (recommended before any T2 cutover).

## 1. Restore the database

1. Confirm a recent dump exists: `dir backups\postgres` (or
   `ls backups/postgres`). If the most recent one is stale, that itself is
   a finding — dumps should be taken on a regular operator cadence (T1 has
   no automated scheduler for this; see "Known gaps" below).
2. Bring up a fresh `postgres` container/volume (or point at the existing
   one if only data, not the container, needs restoring).
3. Run `npm run backup:restore-drill` — this is not just a smoke test, it
   *is* the restore procedure: it restores the latest
   `backups/postgres/*.sql.gz` via `psql` and asserts the invariants a
   booting app depends on (`core`/`audit`/`ops` schemas present,
   `pgmigrations` has rows, `core.identities` has the seeded roles). Read
   its console output for the exact restored counts.
4. For a **real** (non-drill) restore into the live `postgres` service
   rather than the drill's throwaway container: stop the app services
   (`api`, `realtime`, `workers`, `zatca-sim`), restore the same dump file
   directly into the live database with
   `gunzip -c backups/postgres/<file>.sql.gz | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"`,
   then restart the app services.
5. If point-in-time recovery beyond the last dump is needed: WAL segments
   are continuously archived to `backups/wal-archive/` (see
   `docker-compose.yml`'s `archive_command` on the `postgres` service,
   live-verified in S06). Replaying them past a base backup for a true PITR
   restore is the **T2+ operational task** flagged in the scope note above
   — not automated by any script in this repo yet.

## 2. Restore MinIO (media/invoices/POD)

1. Regular backups: `npm run backup:minio` mirrors the 3 buckets
   (`ps-media`, `ps-invoices`, `ps-pod` — see `.env.example`) down to
   `backups/minio/<bucket>/` via `scripts/backup/minio-mirror-backup.mjs`.
   Run this on the same operator cadence as `backup:dump`.
2. To restore: bring up a fresh/empty `minio` service, then run
   `npm run backup:minio -- --restore`. This re-creates any missing bucket
   and re-uploads every locally-backed-up object. It does not delete
   objects that exist remotely but not in the local backup (one-way
   additive mirror both directions — see the script's header comment).

## 3. Redeploy the stack

1. `docker compose up -d` (add `--profile observability` if
   Prometheus/Grafana/Loki are also needed for the recovery itself).
2. Confirm all containers report healthy: `docker compose ps`.

## 4. Verify health

1. `curl https://localhost/api/v1/ready` — expect
   `{"db":true,"storage":true,"realtime":true}` (all three, per PC-10's
   readiness contract).
2. `curl https://localhost/api/v1/health` — expect `{"status":"ok"}`.
3. If the observability profile is up, open Grafana
   (`https://localhost:${GRAFANA_PORT}`, default `3300` per `.env.example`)
   and confirm the 4 provisioned panels (p95 latency, auth-failure rate,
   event-dispatch lag, and the 4th scrape-target panel) are rendering
   fresh non-empty data again — this is the same set of panels S06
   live-verified end to end.
4. Confirm the `ops.incidents` row that triggered this runbook (if any)
   transitions to `resolved_at` set once `workers`' health-watcher's next
   30s poll cycle sees the service healthy again — no manual resolve step
   needed.

## Known gaps (documented, not silently skipped)

- No automated scheduler runs `backup:dump`/`backup:minio`/
  `backup:verify-wal` on a cadence — T1 is a manual/cron-your-own-cadence
  operator responsibility. Wiring a scheduled job (e.g. a `workers/` cron
  task) is in scope for a later hardening session (S21-territory), not S06.
- Off-site replication of `backups/` (both Postgres dumps/WAL and the
  MinIO mirror) is T2/T3 scope per `09-deployment-and-infrastructure.md
  §6` — T1's copies live only on the build host's local disk.
- The timed RPO ≤ 1h drill (actually measuring wall-clock recovery time
  against real production-scale data) is a T2+ operational exercise, not
  reproducible meaningfully against this T1 dev seed dataset.
