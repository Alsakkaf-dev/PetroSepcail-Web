#!/usr/bin/env node
// PC-11 (FR-PC11-001/TC-PC11-001): restore-drill — proves the latest
// `npm run backup:dump` output actually restores clean on a throwaway
// ephemeral Postgres (mirrors scripts/test-migration.mjs's pattern), then
// checks the invariants a booting app depends on: the expected schemas
// exist, migrations are applied, and seeded identities are present.
//
// TC-PC11-001's full DoD also names "a COD checkout completes end-to-end"
// as restore-drill pass criteria. SF-04 checkout doesn't exist yet (lands
// S08) — that leg is deferred and this script should be re-run unchanged
// once it does. This drill validates everything a checkout would need
// first: the DB restores clean, migrations are applied, identities exist.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { Client } from "pg";

const CONTAINER = "ps-restore-drill";
const BACKUP_DIR = path.resolve("backups/postgres");
const MIN_EXPECTED_IDENTITIES = 5; // S01's seed baseline (D-04 5 role identities)
const EXPECTED_SCHEMAS = ["core", "audit", "ops"];

function dockerAvailable() {
  return spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
}

function latestBackup() {
  if (!existsSync(BACKUP_DIR)) return null;
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".sql.gz"))
    .sort();
  return files.length ? path.join(BACKUP_DIR, files[files.length - 1]) : null;
}

function stopContainer() {
  spawnSync("docker", ["stop", CONTAINER], { stdio: "ignore" });
}

async function waitForPostgres(port, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const client = new Client({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "test" });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres did not become ready within ${timeoutMs}ms`);
}

function restoreDump(dumpPath) {
  return new Promise((resolve, reject) => {
    const psql = spawn("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "test"], {
      stdio: ["pipe", "inherit", "inherit"]
    });
    const gunzip = zlib.createGunzip();
    createReadStream(dumpPath).pipe(gunzip).pipe(psql.stdin);
    psql.on("error", reject);
    psql.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`psql restore exited with code ${code}`))));
  });
}

async function main() {
  if (!dockerAvailable()) {
    console.error("[backup:restore-drill] Docker is required but not available.");
    process.exit(1);
  }

  const dumpPath = latestBackup();
  if (!dumpPath) {
    console.error(`[backup:restore-drill] no backup found in ${BACKUP_DIR} — run \`npm run backup:dump\` first.`);
    process.exit(1);
  }

  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  execFileSync("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_PASSWORD=test",
    "-e",
    "POSTGRES_DB=test",
    "-p",
    "0:5432",
    "postgres:16-alpine"
  ]);

  try {
    const portOutput = execFileSync("docker", ["port", CONTAINER, "5432"]).toString().trim();
    const port = Number(portOutput.split(":").pop());
    await waitForPostgres(port);

    console.log(`[backup:restore-drill] restoring ${dumpPath} into an ephemeral Postgres...`);
    await restoreDump(dumpPath);

    const client = new Client({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "test" });
    await client.connect();
    try {
      const { rows: schemaRows } = await client.query(
        "select schema_name from information_schema.schemata where schema_name = any($1)",
        [EXPECTED_SCHEMAS]
      );
      const gotSchemas = schemaRows.map((r) => r.schema_name).sort();
      for (const schema of EXPECTED_SCHEMAS) {
        if (!gotSchemas.includes(schema)) {
          throw new Error(`restored DB is missing expected schema '${schema}'`);
        }
      }

      const {
        rows: [{ n: migrationCount }]
      } = await client.query("select count(*)::int as n from pgmigrations");
      if (migrationCount < 1) {
        throw new Error("restored DB has zero applied migrations");
      }

      const {
        rows: [{ n: identityCount }]
      } = await client.query("select count(*)::int as n from core.identities");
      if (identityCount < MIN_EXPECTED_IDENTITIES) {
        throw new Error(`expected at least ${MIN_EXPECTED_IDENTITIES} identities in the restored DB, found ${identityCount}`);
      }

      console.log(
        `[backup:restore-drill] restored DB has ${migrationCount} migration(s) applied, ${identityCount} identities, schemas: ${gotSchemas.join(", ")}`
      );
    } finally {
      await client.end();
    }

    console.log(
      "[backup:restore-drill] PASS — backup restores clean; DB invariants a checkout would depend on all hold. " +
        "(The 'COD checkout completes' leg of TC-PC11-001 is deferred until SF-04 checkout lands in S08 — re-run this drill unchanged once it does.)"
    );
  } finally {
    stopContainer();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[backup:restore-drill] FAILED:", err.message ?? err);
    stopContainer();
    process.exitCode = 1;
  });
}
