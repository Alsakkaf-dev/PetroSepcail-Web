// Parity gate (D-13/ADR-14): application source must never hardcode
// localhost/ports/URLs — every such value must come from .env. Config files
// (.env*, docker-compose.yml, Caddyfile) are exempt: that's where the
// per-tier value is *supposed* to live. Docker service-name hosts
// (e.g. "postgres:5432") are internal DNS names, stable across every tier,
// and are not a parity violation.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SCAN_ROOTS = [
  "apps/store/app",
  "apps/admin/app",
  "apps/driver/app",
  "services/api/src",
  "services/realtime/src",
  "services/zatca-sim/src",
  "workers/src",
  "packages/ui/src",
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
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
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
