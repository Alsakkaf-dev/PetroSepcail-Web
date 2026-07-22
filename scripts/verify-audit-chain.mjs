#!/usr/bin/env node
// PC-10 (FR-PC10-004/TC-PC10-002): "prev_hash chain validates; tamper
// detected." Recomputes every row's hash using the exact same SQL expression
// as audit.compute_row_hash() (0005_audit_schema.sql), independent of the
// row's own stored prev_hash — a tampered prev_hash is caught by
// prev_hash_ok, a tampered content field is caught by row_hash_ok. Exits
// non-zero (and prints every broken link) the moment the chain doesn't
// verify; exits 0 with a summary when it's intact.
import pg from "pg";
import { pathToFileURL } from "node:url";

const CHAIN_QUERY = `
  with chain as (
    select
      id, actor_id, actor_role, action, resource, resource_id, reason, at,
      prev_hash, row_hash,
      lag(row_hash) over (order by id) as expected_prev_hash
    from audit.audit_log
  )
  select
    id,
    (prev_hash is not distinct from expected_prev_hash) as prev_hash_ok,
    (row_hash = encode(
      digest(
        coalesce(expected_prev_hash, '') || '|' || coalesce(actor_id::text, '') || '|' ||
        coalesce(actor_role, '') || '|' || action || '|' || resource || '|' ||
        coalesce(resource_id, '') || '|' || coalesce(reason, '') || '|' || at::text,
        'sha256'
      ),
      'hex'
    )) as row_hash_ok
  from chain
  order by id;
`;

export async function verifyAuditChain(client) {
  const { rows } = await client.query(CHAIN_QUERY);
  const violations = rows.filter((r) => !r.prev_hash_ok || !r.row_hash_ok);
  return { totalRows: rows.length, violations };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("verify-audit-chain: DATABASE_URL is required");
    process.exitCode = 1;
    return;
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { totalRows, violations } = await verifyAuditChain(client);
    if (violations.length > 0) {
      console.error(`[verify-audit-chain] TAMPER DETECTED — ${violations.length}/${totalRows} row(s) broke the chain:`);
      for (const v of violations) {
        console.error(`  id=${v.id} prev_hash_ok=${v.prev_hash_ok} row_hash_ok=${v.row_hash_ok}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log(`[verify-audit-chain] intact — ${totalRows} row(s), prev_hash/row_hash all validate`);
  } finally {
    await client.end();
  }
}

// Guard (Windows-safe, unlike a raw `file://${argv[1]}` string compare) so
// this module can also be imported for its verifyAuditChain() export (e.g.
// from a test) without triggering a live DB connection as a side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[verify-audit-chain] failed:", err);
    process.exitCode = 1;
  });
}
