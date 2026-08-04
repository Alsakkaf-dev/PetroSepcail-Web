// Parity gate (D-13/ADR-14): application source must never hardcode
// localhost/ports/URLs — every such value must come from .env. Config files
// (.env*, docker-compose.yml, Caddyfile) are exempt: that's where the
// per-tier value is *supposed* to live. Docker service-name hosts
// (e.g. "postgres:5432") are internal DNS names, stable across every tier,
// and are not a parity violation. *.test.ts files are also exempt: an
// integration test that spins up its own ephemeral local Postgres/SMTP
// instance (e.g. services/api/src/routes/auth.e2e.test.ts) always talks to
// 127.0.0.1/localhost by construction, regardless of tier — that's test
// harness config, not application behavior (same reasoning as
// scripts/test-migration.mjs / scripts/test-rls.mjs living outside the
// scanned roots entirely). Shared `testHelpers/` modules get the same
// exemption for the same reason — they exist only to de-duplicate that
// exact ephemeral-instance boilerplate across multiple *.e2e.test.ts files.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SCAN_ROOTS = [
  "apps/store/app",
  "apps/store/components",
  "apps/admin/app",
  "apps/driver/app",
  // apps/supplier was absent from this list entirely — 15 routes that were
  // never parity-checked. components/ is scanned alongside app/ in the two
  // apps that have one; it is app source by any reading, and only escaped
  // because the original list was written before either directory existed.
  //
  // lib/ stays out, deliberately. apps/driver/lib/authClient.ts carries a
  // hardcoded production API base as a documented fix for a real outage (the
  // committed localhost value was baked into a production bundle and broke
  // driver login), and apps/*/lib/api.ts comments name localhost while
  // explaining why it must never be used. Scanning lib/ would fail the build
  // on both.
  "apps/supplier/app",
  "apps/supplier/components",
  "services/api/src",
  "services/realtime/src",
  "services/zatca-sim/src",
  "workers/src",
  "packages/ui/src",
  "packages/i18n/src",
  "packages/app-shell/src",
  "packages/contracts/src"
];

const EXCLUDE_DIRS = new Set(["node_modules", ".next", "dist", "coverage"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".mjs"]);
const VIOLATION_PATTERN = /localhost|127\.0\.0\.1|https?:\/\//i;

function walk(dir, files = []) {
  if (!statSync(dir, { throwIfNoEntry: false })) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (
      SOURCE_EXT.has(path.extname(entry.name)) &&
      !entry.name.endsWith(".test.ts") &&
      !dir.split(path.sep).includes("testHelpers")
    ) {
      files.push(full);
    }
  }
  return files;
}

const violations = [];

for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (VIOLATION_PATTERN.test(line)) {
        violations.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error("[parity-grep] hardcoded host/URL found outside .env config:");
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}

console.log("[parity-grep] clean — no hardcoded localhost/ports/URLs in application source");
