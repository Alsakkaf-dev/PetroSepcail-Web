#!/usr/bin/env node
// PC-11 (FR-PC11-001/TC-PC11-001): T1's backup deliverable is `pg_dump` to a
// local folder (09-deployment-and-infrastructure.md §6 — off-site
// replication is a T2+ operational concern, not a T1 build task). Runs
// *inside* the running `postgres` container via `docker compose exec` so no
// credentials are duplicated here — POSTGRES_USER/POSTGRES_DB are read via
// shell expansion of the container's own env (env_file: .env), never passed
// from this script's process.env.
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGzip } from "node:zlib";

const BACKUP_DIR = path.resolve("backups/postgres");

function dockerComposeAvailable() {
  const res = spawnSync("docker", ["compose", "version"], { stdio: "ignore" });
  return res.status === 0;
}

function postgresIsUp() {
  const res = spawnSync("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "$POSTGRES_USER"], {
    stdio: "ignore",
    shell: false
  });
  return res.status === 0;
}

export function backupFilePath(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(BACKUP_DIR, `petrospecial-${stamp}.sql.gz`);
}

export async function runDump(outPath) {
  mkdirSync(path.dirname(outPath), { recursive: true });

  const dump = spawn(
    "docker",
    ["compose", "exec", "-T", "postgres", "sh", "-c", 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
    { stdio: ["ignore", "pipe", "inherit"] }
  );

  await new Promise((resolve, reject) => {
    const gzip = createGzip();
    const out = createWriteStream(outPath);
    dump.stdout.pipe(gzip).pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    dump.on("error", reject);
    dump.on("exit", (code) => {
      if (code !== 0) reject(new Error(`pg_dump exited with code ${code}`));
    });
  });
}

async function main() {
  if (!dockerComposeAvailable()) {
    console.error("[backup:dump] docker compose is required but not available.");
    process.exit(1);
  }
  if (!postgresIsUp()) {
    console.error("[backup:dump] the `postgres` service is not running — start it with `docker compose up -d postgres` first.");
    process.exit(1);
  }

  const outPath = backupFilePath();
  await runDump(outPath);
  console.log(`[backup:dump] wrote ${outPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[backup:dump] failed:", err);
    process.exitCode = 1;
  });
}
