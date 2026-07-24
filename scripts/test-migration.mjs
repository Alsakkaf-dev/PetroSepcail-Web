// Migration test (ADR-13, revised under D-15/D-17): applies db/migrations to
// a throwaway ephemeral Postgres, proving the runner + connection wiring
// work. Docker is retired from this project (D-15 hosting pivot, host
// machine no longer has it installed) — this now boots a real Postgres
// binary directly via `embedded-postgres`, no container runtime required.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

const PORT = 54329;
const PASSWORD = "test";

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), "ps-migration-test-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: PASSWORD,
    port: PORT,
    persistent: false,
    // Windows' auto-detected locale defaults initdb to a non-UTF8 codepage
    // (e.g. WIN1252), which then rejects the Arabic seed data (0023) — force
    // UTF8 explicitly rather than relying on the host's locale.
    initdbFlags: ["--encoding=UTF8", "--locale=C"]
  });

  await pg.initialise();
  await pg.start();

  try {
    execFileSync(
      "npx",
      ["node-pg-migrate", "-m", "db/migrations", "--migration-file-language", "sql", "up"],
      {
        // All arguments above are static string literals (no interpolated
        // input), so shell:true carries no injection risk here — it's
        // required on Windows, where .cmd shims (npx.cmd) cannot be
        // spawned directly without going through a shell.
        stdio: "inherit",
        shell: true,
        env: {
          ...process.env,
          DATABASE_URL: `postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres`
        }
      }
    );

    console.log("[test:migration] migrations applied cleanly on ephemeral Postgres");
  } finally {
    await pg.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
