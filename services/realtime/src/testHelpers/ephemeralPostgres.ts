// Shared E2E test helper: boots a real, throwaway Postgres instance and
// applies db/migrations against it. Docker is retired from this project
// (D-15 hosting pivot) and is no longer installed on the dev machine, so
// roundTrip.e2e.test.ts now goes through this instead of `docker run
// postgres:16-alpine` — a real Postgres 18 binary via `embedded-postgres`,
// no container runtime required. Mirrors services/api's identical helper
// (duplicated rather than shared across the workspace boundary).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

export interface EphemeralPostgres {
  dbUrl: string;
  stop: () => Promise<void>;
}

export async function startEphemeralPostgres(port: number): Promise<EphemeralPostgres> {
  const dataDir = mkdtempSync(join(tmpdir(), "ps-e2e-pg-"));
  const password = "test";
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password,
    port,
    persistent: false,
    // Windows' auto-detected locale otherwise picks a non-UTF8 codepage
    // (e.g. WIN1252), which then rejects the Arabic seed data (0023).
    initdbFlags: ["--encoding=UTF8", "--locale=C"]
  });

  await pg.initialise();
  await pg.start();

  const dbUrl = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;

  // Supabase pre-provisions every project with an `extensions` schema before
  // any of our own migrations run (0033's own comment documents this). 0072
  // grants `usage on schema extensions`, which fails outright if the schema
  // doesn't exist - replicate Supabase's pre-provisioning rather than
  // editing the already-applied 0072 (GIT-COMMIT-LAW: never edit an applied
  // migration). Mirrors services/api's identical fix.
  const bootstrap = new Client({ connectionString: dbUrl });
  await bootstrap.connect();
  await bootstrap.query("create schema if not exists extensions;");
  await bootstrap.end();

  execFileSync(
    "npx",
    ["node-pg-migrate", "-m", "db/migrations", "--migration-file-language", "sql", "up"],
    {
      // All arguments above are static string literals (no interpolated
      // input), so shell:true carries no injection risk here — it's
      // required on Windows, where .cmd shims (npx.cmd) cannot be spawned
      // directly without going through a shell.
      stdio: "inherit",
      shell: true,
      env: { ...process.env, DATABASE_URL: dbUrl }
    }
  );

  return {
    dbUrl,
    stop: async () => {
      await pg.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}
