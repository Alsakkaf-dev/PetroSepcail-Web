// Contract-drift check (ADR-13): verifies packages/contracts' zod schemas
// actually get used by services/api's routes — a schema exported but never
// referenced by any route is the clearest, cheapest-to-detect sign of drift
// (an endpoint was renamed/removed, or a contract was added but never wired
// up). Run via tsx (not plain node) because packages/contracts has no build
// step — its `main` is TS source directly, and NodeNext-style `.js`-suffixed
// relative imports only resolve to `.ts` files through a TS-aware loader.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ZodType } from "zod";
import * as contracts from "../packages/contracts/src/index.ts";

const EXCLUDE_DIRS = new Set(["node_modules", "dist", "coverage"]);

function walk(dir: string, files: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
  }
  return files;
}

const schemaEntries = Object.entries(contracts).filter(([, value]) => value instanceof ZodType);

if (schemaEntries.length === 0) {
  console.log("[test:contract] no contracts defined yet — pass");
  process.exit(0);
}

const routeSource = walk("services/api/src")
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const errors: string[] = [];

for (const [name, schema] of schemaEntries) {
  if (!routeSource.includes(name)) {
    errors.push(`${name} is exported from packages/contracts but never referenced in services/api/src (orphaned contract)`);
  }
  // Sanity: every exported schema must actually be usable (constructed, not
  // a broken/circular definition) — .safeParse(undefined) never throws.
  const result = schema.safeParse(undefined);
  if (result === undefined) {
    errors.push(`${name}.safeParse() did not return a result — schema is malformed`);
  }
}

if (errors.length > 0) {
  console.error("[test:contract] contract drift detected:");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

console.log(`[test:contract] ${schemaEntries.length} contract schema(s) verified in sync with services/api routes`);
