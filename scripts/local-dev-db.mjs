// Local-only convenience script (untracked, not part of any CI/build path):
// boots a persistent embedded Postgres (same `embedded-postgres` binary the
// e2e suites use, see services/api/src/testHelpers/ephemeralPostgres.ts) and
// keeps it running in the foreground so `services/api`/`apps/driver` have a
// real local database to talk to, without Docker or a Neon account.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

const PORT = 55432;
const PASSWORD = "localdev";
const DATA_DIR = "secrets/pgdata";

async function main() {
  const firstBoot = !existsSync(DATA_DIR);
  if (firstBoot) mkdirSync(DATA_DIR, { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: PASSWORD,
    port: PORT,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"]
  });

  if (firstBoot) await pg.initialise();
  await pg.start();
  const dbUrl = `postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres`;
  console.log(`[local-dev-db] Postgres listening on 127.0.0.1:${PORT}`);

  execFileSync("npx", ["node-pg-migrate", "-m", "db/migrations", "--migration-file-language", "sql", "up"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DATABASE_URL: dbUrl }
  });
  console.log(`[local-dev-db] DATABASE_URL=${dbUrl}`);
  console.log("[local-dev-db] ready — leave this running; Ctrl+C to stop");

  const shutdown = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
