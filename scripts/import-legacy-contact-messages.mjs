#!/usr/bin/env node
// PC-11 (TC-PC11-002): one-time import of the legacy site's Supabase
// `contact_messages` table into this platform's `core.contact_messages`
// (migration 0018, itself a SPEC-GAP — 04-database-design.md never defines
// this table). Idempotent upsert: keyed on the source row's own `id` when
// present, else on `(email, created_at)`.
//
// This script does NOT and CANNOT fetch the export itself. The legacy
// site's Supabase anon key (assets/js/main.js's `PS.CONTACT`) is
// INSERT-only by design (RLS on the legacy project only grants anon
// `insert` — the contact form is a one-way mailbox); reading the existing
// rows back out requires the project owner's own Supabase login. Producing
// the export file (JSON array or CSV, via the Supabase dashboard's table
// export) is a one-time **operator** action outside any agent's credential
// scope (see memory `[[petrospecial-site-architecture]]`) — this script
// only ever consumes a file already sitting on disk, never stubs or fakes
// that data.
//
// Usage: node scripts/import-legacy-contact-messages.mjs --file <path.json|path.csv>
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const REQUIRED_FIELDS = ["name", "email", "message", "created_at"];
const VALID_LOCALES = new Set(["ar", "en"]);

function parseArgs(argv) {
  const idx = argv.indexOf("--file");
  if (idx === -1 || !argv[idx + 1]) {
    throw new Error("missing required --file <path.json|path.csv> argument");
  }
  return { file: argv[idx + 1] };
}

// Minimal RFC 4180 CSV parser (quoted fields, embedded commas/newlines/"" escaping).
// No new dependency for a one-shot operator script over a 6-column export.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) pushRow();

  const [header, ...dataRows] = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  return dataRows.map((r) => Object.fromEntries(header.map((h, idx2) => [h.trim(), r[idx2] ?? ""])));
}

export function loadRecords(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("JSON export must be an array of row objects");
    return parsed;
  }
  if (ext === ".csv") {
    return parseCsv(raw);
  }
  throw new Error(`unsupported file extension "${ext}" — expected .json or .csv`);
}

export function validateRecord(record) {
  for (const field of REQUIRED_FIELDS) {
    if (!record[field] || String(record[field]).trim() === "") {
      return `missing required field "${field}"`;
    }
  }
  if (record.locale && !VALID_LOCALES.has(record.locale)) {
    return `invalid locale "${record.locale}" (expected ar|en)`;
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function upsertRecord(client, record) {
  const hasId = record.id && UUID_RE.test(String(record.id));
  const locale = VALID_LOCALES.has(record.locale) ? record.locale : "ar";
  const phone = record.phone && String(record.phone).trim() !== "" ? record.phone : null;

  if (hasId) {
    const { rows } = await client.query(
      `insert into core.contact_messages (id, name, email, phone, message, locale, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         name = excluded.name, email = excluded.email, phone = excluded.phone,
         message = excluded.message, locale = excluded.locale
       returning (xmax = 0) as inserted`,
      [record.id, record.name, record.email, phone, record.message, locale, record.created_at]
    );
    return rows[0].inserted ? "inserted" : "updated";
  }

  const { rows } = await client.query(
    `insert into core.contact_messages (name, email, phone, message, locale, created_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (email, created_at) do update set
       name = excluded.name, phone = excluded.phone, message = excluded.message, locale = excluded.locale
     returning (xmax = 0) as inserted`,
    [record.name, record.email, phone, record.message, locale, record.created_at]
  );
  return rows[0].inserted ? "inserted" : "updated";
}

async function main() {
  const { file } = parseArgs(process.argv.slice(2));
  const records = loadRecords(file);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[import-contact-messages] DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }

  let inserted = 0;
  let updated = 0;
  const invalid = [];

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const [i, record] of records.entries()) {
      const err = validateRecord(record);
      if (err) {
        invalid.push({ index: i, err, record });
        continue;
      }
      const outcome = await upsertRecord(client, record);
      if (outcome === "inserted") inserted++;
      else updated++;
    }
  } finally {
    await client.end();
  }

  console.log(`[import-contact-messages] source rows read: ${records.length}`);
  console.log(`[import-contact-messages] inserted: ${inserted}, updated: ${updated}, invalid/skipped: ${invalid.length}`);
  console.log(`[import-contact-messages] matched target rows: ${inserted + updated} / ${records.length} source rows`);
  if (invalid.length > 0) {
    console.warn("[import-contact-messages] skipped rows:");
    for (const { index, err } of invalid) {
      console.warn(`  row ${index}: ${err}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[import-contact-messages] failed:", err.message ?? err);
    process.exitCode = 1;
  });
}
