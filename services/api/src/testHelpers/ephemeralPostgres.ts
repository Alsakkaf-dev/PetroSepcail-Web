// Shared E2E test helper: boots a real, throwaway Postgres instance and
// applies db/migrations against it. Docker is retired from this project
// (D-15 hosting pivot) and is no longer installed on the dev machine, so
// every e2e suite that used to `docker run postgres:16-alpine` now goes
// through this instead — a real Postgres 18 binary via `embedded-postgres`,
// no container runtime required. Mirrors scripts/test-migration.mjs.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

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
