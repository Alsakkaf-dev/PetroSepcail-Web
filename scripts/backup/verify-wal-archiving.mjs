#!/usr/bin/env node
// PC-11 (FR-PC11-001): proves continuous WAL archiving (docker-compose.yml's
// postgres `archive_command`) is genuinely working, not just configured —
// forces a WAL segment switch and confirms a new file actually lands in the
// host-side backups/wal-archive/ directory within a real deadline.
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ARCHIVE_DIR = path.resolve("backups/wal-archive");
const DEADLINE_MS = 15_000;
const POLL_MS = 500;

function listArchive() {
  return existsSync(ARCHIVE_DIR) ? new Set(readdirSync(ARCHIVE_DIR)) : new Set();
}

function switchWal() {
  const res = spawnSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "sh", "-c", 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select pg_switch_wal();"'],
    { stdio: "inherit" }
  );
  if (res.status !== 0) throw new Error("pg_switch_wal() failed — is the postgres service running?");
}

export async function verifyWalArchiving() {
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const before = listArchive();
  switchWal();

  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    const after = listArchive();
    const newFile = [...after].find((f) => !before.has(f));
    if (newFile) return newFile;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return null;
}

async function main() {
  const newFile = await verifyWalArchiving();
  if (!newFile) {
    console.error(
      `[backup:verify-wal] no new WAL segment appeared in ${ARCHIVE_DIR} within ${DEADLINE_MS}ms — archiving is NOT working`
    );
    process.exit(1);
  }
  console.log(`[backup:verify-wal] WAL archiving confirmed live — new segment: ${newFile}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[backup:verify-wal] failed:", err);
    process.exitCode = 1;
  });
}
