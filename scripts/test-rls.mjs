// RLS verification (PC-DB-2, S01 Out contract: "RLS test suite green").
// Spins up a throwaway ephemeral Postgres, applies db/migrations for real,
// then exercises the actual RLS policies as app_user/app_service_role — proving
// isolation genuinely works rather than just that the DDL compiles. Docker
// is retired from this project (D-15 hosting pivot) — this boots a real
// Postgres binary directly via `embedded-postgres`, no container runtime.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { verifyAuditChain } from "./verify-audit-chain.mjs";

const PORT = 54330;
const PASSWORD = "test";
let failures = 0;

function ok(label, cond) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label}`);
    failures += 1;
  }
}

async function setClaims(client, claims) {
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    claims ? JSON.stringify(claims) : ""
  ]);
}

async function asRole(client, role) {
  await client.query(`set role ${role}`);
}

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), "ps-rls-test-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: PASSWORD,
    port: PORT,
    persistent: false,
    // Force UTF8 regardless of the host's auto-detected Windows codepage —
    // see test-migration.mjs for the same fix (Arabic seed data otherwise
    // fails to load under a WIN1252 cluster encoding).
    initdbFlags: ["--encoding=UTF8", "--locale=C"]
  });

  await pg.initialise();
  await pg.start();

  try {
    const dbUrl = `postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres`;

    // Supabase pre-provisions every project with an `extensions` schema
    // before any of our own migrations run (0033's own comment documents
    // this). 0072 grants `usage on schema extensions`, which fails outright
    // if the schema doesn't exist - replicate Supabase's pre-provisioning
    // rather than editing the already-applied 0072.
    const bootstrap = new Client({ connectionString: dbUrl });
    await bootstrap.connect();
    await bootstrap.query("create schema if not exists extensions;");
    await bootstrap.end();

    execFileSync(
      "npx",
      ["node-pg-migrate", "-m", "db/migrations", "--migration-file-language", "sql", "up"],
      {
        stdio: "inherit",
        shell: true,
        env: {
          ...process.env,
          DATABASE_URL: dbUrl
        }
      }
    );

    const admin = new Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: PASSWORD, database: "postgres" });
    await admin.connect();

    console.log("\n[test:rls] core.identities — self-row isolation");
    {
      await asRole(admin, "app_user");
      await setClaims(admin, null);
      const noClaims = await admin.query("select id from core.identities");
      ok("no claims set -> 0 rows visible (default-deny)", noClaims.rowCount === 0);

      await setClaims(admin, { sub: "00000000-0000-0000-0000-000000000001", role: "customer" });
      const own = await admin.query("select id from core.identities");
      ok("customer sees exactly 1 row", own.rowCount === 1);
      ok("customer sees only their own id", own.rows[0]?.id === "00000000-0000-0000-0000-000000000001");
      await admin.query("reset role");
    }

    console.log("[test:rls] app_service_role bypass");
    {
      await asRole(admin, "app_service_role");
      const all = await admin.query("select id from core.identities");
      ok("app_service_role sees all 5 seeded identities", all.rowCount === 5);
      await admin.query("reset role");
    }

    console.log("[test:rls] core.i18n_strings — world-readable");
    {
      const trueCount = await admin.query("select count(*)::int from core.i18n_strings");
      await asRole(admin, "app_user");
      await setClaims(admin, null);
      const publicCount = await admin.query("select count(*)::int from core.i18n_strings");
      ok(
        `unauthenticated app_user sees all ${trueCount.rows[0].count} i18n rows`,
        publicCount.rows[0].count === trueCount.rows[0].count && trueCount.rows[0].count > 0
      );
      await admin.query("reset role");
    }

    console.log("[test:rls] core.settings — admin-only read");
    {
      const trueCount = await admin.query("select count(*)::int from core.settings");
      await asRole(admin, "app_user");
      await setClaims(admin, { sub: "00000000-0000-0000-0000-000000000001", role: "customer" });
      const asCustomer = await admin.query("select count(*)::int from core.settings");
      ok("customer sees 0 settings rows", asCustomer.rows[0].count === 0);

      await setClaims(admin, { sub: "00000000-0000-0000-0000-000000000004", role: "admin" });
      const asAdmin = await admin.query("select count(*)::int from core.settings");
      ok(
        `admin sees all ${trueCount.rows[0].count} settings rows`,
        asAdmin.rows[0].count === trueCount.rows[0].count && trueCount.rows[0].count > 0
      );
      await admin.query("reset role");
    }

    console.log("[test:rls] core.auth_tokens — no end-user policy at all");
    {
      const tok = await admin.query(
        `insert into core.auth_tokens (identity_id, family_id, token_hash, role, expires_at)
         values ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'seed-hash', 'customer', now() + interval '1 day')
         returning id`
      );
      ok("service-side insert of a token succeeds", tok.rowCount === 1);

      await asRole(admin, "app_user");
      await setClaims(admin, { sub: "00000000-0000-0000-0000-000000000001", role: "customer" });
      let ownerDenied = false;
      try {
        await admin.query("select id from core.auth_tokens");
      } catch (err) {
        ownerDenied = err.code === "42501"; // permission denied — no table GRANT at all
      }
      ok("owning identity is denied at the table-grant level (secret, app_service_role only)", ownerDenied);
      await admin.query("reset role");

      await asRole(admin, "app_service_role");
      const asService = await admin.query("select id from core.auth_tokens");
      ok("app_service_role sees the token row", asService.rowCount === 1);
      await admin.query("reset role");
    }

    console.log("[test:rls] core.addresses — self CRUD + cross-identity write blocked");
    {
      await admin.query(
        `insert into core.addresses (id, identity_id, recipient_name, phone, line1)
         values
           ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Cust One', '+966500000001', 'Line 1'),
           ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Supp Two', '+966500000002', 'Line 1')`
      );

      await asRole(admin, "app_user");
      await setClaims(admin, { sub: "00000000-0000-0000-0000-000000000001", role: "customer" });
      const visible = await admin.query("select id from core.addresses");
      ok("customer sees exactly their own 1 address", visible.rowCount === 1 && visible.rows[0].id === "10000000-0000-0000-0000-000000000001");

      let blocked = false;
      try {
        await admin.query(
          `insert into core.addresses (identity_id, recipient_name, phone, line1)
           values ('00000000-0000-0000-0000-000000000002', 'Hijack', '+966500000009', 'Line 1')`
        );
      } catch {
        blocked = true;
      }
      ok("customer cannot insert an address for another identity (with check blocks it)", blocked);
      await admin.query("reset role");
    }

    console.log("[test:rls] core.admin_read_customer — SECURITY DEFINER admin-only PII path");
    {
      await asRole(admin, "app_user");
      await setClaims(admin, { sub: "00000000-0000-0000-0000-000000000001", role: "customer" });
      let deniedForCustomer = false;
      try {
        await admin.query("select * from core.admin_read_customer($1, $2)", [
          "00000000-0000-0000-0000-000000000001",
          "self-test"
        ]);
      } catch {
        deniedForCustomer = true;
      }
      ok("customer role is forbidden from calling admin_read_customer", deniedForCustomer);

      await setClaims(admin, { sub: "00000000-0000-0000-0000-000000000004", role: "admin" });
      // 0063 changed the return type to a scalar jsonb, so `select *` yields
      // one column named after the function (not spread columns) - the real
      // API route (adminGovernance.ts) already unwraps it this way.
      const res = await admin.query("select core.admin_read_customer($1, $2) as admin_read_customer", [
        "00000000-0000-0000-0000-000000000001",
        "self-test"
      ]);
      ok(
        "admin role can call admin_read_customer and gets the row back",
        res.rows[0]?.admin_read_customer?.id === "00000000-0000-0000-0000-000000000001"
      );
      await admin.query("reset role");

      const auditRows = await admin.query(
        "select row_hash, prev_hash from audit.audit_log where action = 'pii_read' order by id"
      );
      ok("admin_read_customer wrote an audit_log row", auditRows.rowCount >= 1);
      ok("audit row_hash is populated by the hash-chain trigger", auditRows.rows.every((r) => r.row_hash));
    }

    console.log("[test:rls] core.get_setting — caller-privilege function respects RLS");
    {
      await asRole(admin, "app_user");
      await setClaims(admin, { sub: "00000000-0000-0000-0000-000000000001", role: "customer" });
      const asCustomer = await admin.query("select core.get_setting('vat_rate') as v");
      ok("customer gets null from get_setting (RLS-blocked, not security definer)", asCustomer.rows[0].v === null);

      await setClaims(admin, { sub: "00000000-0000-0000-0000-000000000004", role: "admin" });
      const asAdmin = await admin.query("select core.get_setting('vat_rate') as v");
      ok("admin gets the real vat_rate value from get_setting", Number(asAdmin.rows[0].v) === 0.15);
      await admin.query("reset role");
    }

    console.log("[test:rls] loyalty.campaign_coupons — RLS enforced, not disabled (0073)");
    {
      await asRole(admin, "app_service_role");
      const activeCampaign = await admin.query(
        `insert into loyalty.campaigns (name_ar, name_en, starts_at, ends_at, status)
         values ('حملة', 'Active campaign', now() - interval '1 day', now() + interval '1 day', 'active')
         returning id`
      );
      const endedCampaign = await admin.query(
        `insert into loyalty.campaigns (name_ar, name_en, starts_at, ends_at, status)
         values ('منتهية', 'Ended campaign', now() - interval '10 day', now() - interval '1 day', 'ended')
         returning id`
      );
      const coupon = await admin.query(
        `insert into loyalty.coupons (code, type, value) values ('RLSTEST10', 'percent', 10) returning id`
      );
      await admin.query(
        "insert into loyalty.campaign_coupons (campaign_id, coupon_id) values ($1, $2), ($3, $2)",
        [activeCampaign.rows[0].id, coupon.rows[0].id, endedCampaign.rows[0].id]
      );
      await admin.query("reset role");

      await asRole(admin, "app_user");
      await setClaims(admin, null);
      const visible = await admin.query("select campaign_id from loyalty.campaign_coupons");
      ok(
        "unauthenticated app_user sees only the active campaign's row, not the ended one",
        visible.rowCount === 1 && visible.rows[0].campaign_id === activeCampaign.rows[0].id
      );
      await admin.query("reset role");
    }

    console.log("[test:rls] audit.audit_log — immutability + hash-chain tamper detection (TC-PC10-002)");
    {
      await admin.query(
        `insert into audit.audit_log(actor_id, actor_role, action, resource, resource_id, reason, at)
         values (null, 'app_service_role', 'chain_test', 'chain_resource', '1', null, now())`
      );

      const before = await verifyAuditChain(admin);
      ok("chain verifies intact after a genuine insert", before.violations.length === 0 && before.totalRows >= 1);

      await asRole(admin, "app_service_role");
      let updateDenied = false;
      try {
        await admin.query("update audit.audit_log set action = 'tampered' where action = 'chain_test'");
      } catch (err) {
        updateDenied = err.code === "42501";
      }
      ok("app_service_role UPDATE on audit_log is permission-denied (immutability)", updateDenied);

      let deleteDenied = false;
      try {
        await admin.query("delete from audit.audit_log where action = 'chain_test'");
      } catch (err) {
        deleteDenied = err.code === "42501";
      }
      ok("app_service_role DELETE on audit_log is permission-denied (immutability)", deleteDenied);
      await admin.query("reset role");

      // The table owner (superuser bootstrap role, not app_service_role) can
      // still write directly — proving the *chain verifier* catches tamper
      // that gets past the grant layer some other way (e.g. a raw restore).
      await admin.query("update audit.audit_log set action = 'tampered' where action = 'chain_test'");
      const after = await verifyAuditChain(admin);
      ok(
        "chain verifier detects a tampered row_hash after direct owner tampering",
        after.violations.length === 1 && after.violations[0].row_hash_ok === false
      );

      await admin.query("delete from audit.audit_log where action = 'tampered'");
    }

    await admin.end();

    if (failures > 0) {
      console.error(`\n[test:rls] ${failures} assertion(s) failed`);
      process.exit(1);
    }
    console.log("\n[test:rls] all RLS assertions passed");
  } finally {
    await pg.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
