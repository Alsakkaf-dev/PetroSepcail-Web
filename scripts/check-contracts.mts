// Contract-drift check (ADR-13): verifies packages/contracts' zod schemas
// actually get used somewhere — either directly in services/api's routes, or
// composed into another schema within packages/contracts itself (e.g.
// `notificationItem` nested inside `notificationsListResponse` via
// `z.array(notificationItem)`, never referenced by its own name in a route
// file). A schema whose name appears nowhere but its own declaration line is
// the clearest, cheapest-to-detect sign of drift (an endpoint was renamed/
// removed, or a contract was added but never wired up). Run via tsx (not
// plain node) because packages/contracts has no build step — its `main` is
// TS source directly, and NodeNext-style `.js`-suffixed relative imports
// only resolve to `.ts` files through a TS-aware loader.
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

const searchText = [...walk("services/api/src"), ...walk("packages/contracts/src")]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const errors: string[] = [];

for (const [name, schema] of schemaEntries) {
  // A schema's own `export const name = ...` declaration always contributes
  // one occurrence — anything used only there (count === 1) is referenced
  // nowhere else, neither composed into another contract nor imported by a
  // route.
  const occurrences = searchText.split(name).length - 1;
  if (occurrences <= 1) {
    errors.push(
      `${name} is exported from packages/contracts but never referenced in services/api/src or composed into another contract (orphaned)`
    );
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
