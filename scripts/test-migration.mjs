// Migration test (ADR-13): applies db/migrations to a throwaway ephemeral
// Postgres container, proving the runner + connection wiring work. There are
// zero migration files until S01 — that is expected to pass trivially here.
import { execFileSync, spawnSync } from "node:child_process";
import { Client } from "pg";

const CONTAINER = "ps-migration-test";

function dockerAvailable() {
  const res = spawnSync("docker", ["--version"], { stdio: "ignore" });
  return res.status === 0;
}

function stopContainer() {
  spawnSync("docker", ["stop", CONTAINER], { stdio: "ignore" });
}

async function waitForPostgres(port, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const client = new Client({
      host: "127.0.0.1",
      port,
      user: "postgres",
      password: "test",
      database: "test"
    });
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

async function main() {
  if (!dockerAvailable()) {
    console.error(
      "[test:migration] Docker is required to run the ephemeral-Postgres migration test " +
        "(ADR-13) but is not available on this machine. Install Docker (or Docker Desktop) " +
        "and re-run `npm run test:migration` / `npm run verify`."
    );
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

    execFileSync(
      "npx",
      [
        "node-pg-migrate",
        "-m",
        "db/migrations",
        "--migration-file-language",
        "sql",
        "up"
      ],
      {
        // All arguments above are static string literals (no interpolated
        // input), so shell:true carries no injection risk here — it's
        // required on Windows, where .cmd shims (npx.cmd) cannot be
        // spawned directly without going through a shell.
        stdio: "inherit",
        shell: true,
        env: {
          ...process.env,
          DATABASE_URL: `postgres://postgres:test@127.0.0.1:${port}/test`
        }
      }
    );

    console.log("[test:migration] migrations applied cleanly on ephemeral Postgres");
  } finally {
    stopContainer();
  }
}

main().catch((err) => {
  console.error(err);
  stopContainer();
  process.exit(1);
});
