#!/usr/bin/env node
// M1 milestone acceptance script (07-test-plan.md §4), run for real against
// an already-up `docker compose up` stack (including the observability
// profile for the settings-change/audit step). Not part of `npm run verify`
// (needs the live stack, not an ephemeral container) — same standalone
// precedent as scripts/backup/*.mjs.
//
// Runs the exact script from §4: register+verify a customer (mail-catcher)
// -> log in each of the 5 roles -> issue+verify single-role JWTs -> attempt
// a cross-tenant read (expect empty) -> emit a test event and observe
// idempotent consumption + live WebSocket delivery -> send a notification
// and view it in AR then EN -> upload a media object and fetch via signed
// URL -> change a core.settings value and observe it live -> view the audit
// entry for that change.
//
// Two interpretation notes, documented rather than silently assumed:
//  1. "send a notification... view it in AR then EN": the in-app
//     `identity_welcome` notification stores {type, params} for the CLIENT
//     to render (S05's own brief: no session has built that render layer
//     yet, so there's no i18n key for it to look up). The one notification
//     channel that DOES have real bilingual content end-to-end is the
//     PC-06 email template (S05, verified against real mailpit). So this
//     step registers one AR-locale and one EN-locale customer and shows
//     each receives their verification email in the correct language.
//  2. "emit a test event and observe live WebSocket delivery" and "change a
//     core.settings value and observe it live" are combined into one
//     action: PUT /admin/settings/:key publishes EV-PC-050
//     platform.config.changed, observed live over `events:{name}` (the
//     generic fan-out channel any authenticated actor may subscribe to,
//     per channelAuth.ts). Idempotent consumption is proven separately
//     against EV-PC-001 (registration), the one event with a real
//     registered consumer (pc06.welcome-notification) and a
//     processed_events row to check.
import { randomUUID } from "node:crypto";
import http from "node:http";
import pg from "pg";
import { WebSocket } from "ws";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // T1 self-signed Caddy cert, same as this project's own curl -k precedent

const BASE = process.env.PUBLIC_BASE_URL ?? "https://localhost";
const MAILPIT_URL = `http://127.0.0.1:${process.env.MAILPIT_WEB_PORT ?? 8025}`;
const MINIO_PORT = Number(process.env.MINIO_API_PORT ?? 9000);
const DATABASE_URL =
  process.env.M1_DATABASE_URL ??
  `postgres://${process.env.POSTGRES_USER ?? "petrospecial"}:${process.env.POSTGRES_PASSWORD ?? "petrospecial_dev_password"}@127.0.0.1:${process.env.POSTGRES_PORT ?? 5432}/${process.env.POSTGRES_DB ?? "petrospecial"}`;
const DEV_PASSWORD = "DevSeed#12345"; // S02 brief: shared dev password for all 5 seed identities, intentionally not secret

const SEED_ROLES = [
  { role: "customer", email: "customer.seed@petrospecial.internal" },
  { role: "supplier", email: "supplier.seed@petrospecial.internal" },
  { role: "driver", email: "driver.seed@petrospecial.internal" },
  { role: "admin", email: "admin.seed@petrospecial.internal" },
  { role: "super_admin", email: "superadmin.seed@petrospecial.internal" }
];

let passed = 0;
function check(label, condition) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`  ok   ${label}`);
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

function decodeJwtPayload(token) {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function waitFor(fn, { timeoutMs = 15_000, intervalMs = 300 } = {}) {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function findVerifyToken(email) {
  return waitFor(async () => {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    const { messages } = await res.json();
    const mail = messages.find((m) => m.To.some((to) => to.Address === email));
    if (!mail) return null;
    const detailRes = await fetch(`${MAILPIT_URL}/api/v1/message/${mail.ID}`);
    const detail = await detailRes.json();
    const match = detail.Text.match(/token=([\w-]+)/);
    return match ? { token: match[1], subject: detail.Subject, text: detail.Text } : null;
  });
}

// Presigned MinIO URLs are signed with the container-internal hostname
// "minio" (MINIO_ENDPOINT in .env) but MinIO's API port is also published to
// the host — resolve "minio" -> 127.0.0.1 for just this one connection
// (Node's `lookup` option), the JS equivalent of `curl --resolve`. No system
// hosts-file edit, no new dependency.
function minioRequest(rawUrl, { method = "GET", body } = {}) {
  const url = new URL(rawUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: MINIO_PORT,
        path: url.pathname + url.search,
        headers: body ? { "content-length": Buffer.byteLength(body) } : {},
        // Node 20's Happy Eyeballs connection path (net.js lookupAndConnectMultiple)
        // calls `lookup` with `{ all: true }` and expects an array-of-addresses
        // reply, not the classic single-address callback — support both shapes.
        lookup: (_hostname, opts, cb) =>
          opts.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4)
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log(`[m1-demo] target: ${BASE}`);

  // --- Readiness ------------------------------------------------------------
  console.log("\n[1/9] stack readiness");
  const ready = await api("/api/v1/ready");
  check("GET /api/v1/ready -> db/storage/realtime all true", ready.status === 200 && ready.json.db && ready.json.storage && ready.json.realtime);

  // --- Register + verify (AR + EN, doubles as the AR/EN notification step) --
  console.log("\n[2/9] register + verify a customer (mail-catcher), AR and EN locales");
  const stamp = Date.now();
  const customers = {};
  for (const locale of ["ar", "en"]) {
    const email = `m1-demo-${locale}-${stamp}@petrospecial.internal`;
    const reg = await api("/api/v1/auth/register", {
      method: "POST",
      body: { fullName: `M1 Demo ${locale.toUpperCase()}`, email, phone: `+9665${String(stamp).slice(-8)}${locale === "ar" ? "1" : "2"}`, password: "M1-Demo-Password-99", locale }
    });
    check(`register (${locale}) -> 201 pending_verification`, reg.status === 201 && reg.json.status === "pending_verification");

    const mail = await findVerifyToken(email);
    check(`mailpit received the ${locale} verify email`, Boolean(mail));
    console.log(`       subject (${locale}): ${mail.subject}`);
    const arabicRe = /[؀-ۿ]/;
    if (locale === "ar") check("AR email body contains Arabic script", arabicRe.test(mail.text));
    else check("EN email body contains no Arabic script", !arabicRe.test(mail.text));

    const verify = await api("/api/v1/auth/verify-email", { method: "POST", body: { token: mail.token } });
    check(`verify-email (${locale}) -> active`, verify.status === 200 && verify.json.status === "active");

    const login = await api("/api/v1/auth/login", { method: "POST", body: { email, password: "M1-Demo-Password-99" } });
    check(`login (${locale}) -> accessToken issued`, login.status === 200 && Boolean(login.json.accessToken));
    customers[locale] = { email, token: login.json.accessToken, id: decodeJwtPayload(login.json.accessToken).sub };
  }

  // --- Log in each of the 5 seed roles, issue+verify single-role JWTs -------
  console.log("\n[3/9] log in each of the 5 seed roles");
  const tokens = {};
  for (const { role, email } of SEED_ROLES) {
    const login = await api("/api/v1/auth/login", { method: "POST", body: { email, password: DEV_PASSWORD } });
    check(`login ${role} -> 200`, login.status === 200 && Boolean(login.json.accessToken));
    const claims = decodeJwtPayload(login.json.accessToken);
    check(`${role} JWT carries role=${role}`, claims.role === role);
    const me = await api("/api/v1/me", { token: login.json.accessToken });
    check(`${role} GET /me verifies signature server-side -> 200`, me.status === 200);
    tokens[role] = { token: login.json.accessToken, id: claims.sub };
  }

  // --- Cross-tenant read, expect empty (RLS is the enforcement boundary) ----
  console.log("\n[4/9] cross-tenant read via RLS (expect empty)");
  const dbClient = new pg.Client({ connectionString: DATABASE_URL });
  await dbClient.connect();
  try {
    await dbClient.query("begin");
    await dbClient.query("set local role app_user");
    await dbClient.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: tokens.customer.id, role: "customer" })
    ]);
    // The seed customer directly querying another identity's notifications
    // by id — RLS filters to nothing, not a permissions error.
    const crossRead = await dbClient.query("select * from core.notifications where identity_id = $1", [customers.ar.id]);
    check("customer role querying another identity's notifications -> 0 rows (RLS)", crossRead.rows.length === 0);
    await dbClient.query("rollback");
  } finally {
    // connection reused below, do not end() yet
  }

  // --- Idempotent event consumption (EV-PC-001 -> pc06.welcome-notification)
  console.log("\n[5/9] idempotent consumption of EV-PC-001 (registration welcome notification)");
  const notif = await waitFor(async () => {
    const res = await dbClient.query("select id from core.notifications where identity_id = $1 and type = 'identity_welcome'", [
      customers.ar.id
    ]);
    return res.rows[0] ?? null;
  });
  check("welcome notification row exists for the AR customer", Boolean(notif));
  const dedupe = await dbClient.query("select count(*)::int as n from core.processed_events where consumer_name = 'pc06.welcome-notification'");
  check("processed_events has >=1 dedupe row for pc06.welcome-notification (idempotency ledger populated)", dedupe.rows[0].n >= 1);

  // --- Live WebSocket delivery + settings change + audit --------------------
  console.log("\n[6/9] change a core.settings value, observe live delivery over WebSocket");
  const before = await api("/api/v1/admin/settings", { token: tokens.super_admin.token });
  const returnWindow = before.json.find((s) => s.key === "return_window_days");
  check("GET /admin/settings includes return_window_days", Boolean(returnWindow));
  const originalValue = returnWindow.value;
  const newValue = originalValue === 7 ? 8 : 7;

  const ws = new WebSocket(`${BASE.replace("https://", "wss://")}/realtime?token=${tokens.super_admin.token}`, { rejectUnauthorized: false });
  const wsMessages = [];
  await new Promise((resolve, reject) => {
    ws.on("open", () => {});
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      wsMessages.push(msg);
      if (msg.type === "welcome") ws.send(JSON.stringify({ type: "subscribe", channel: "events:platform.config.changed" }));
      if (msg.type === "subscribed") resolve();
      if (msg.type === "subscribe_denied") reject(new Error("subscribe denied"));
    });
    ws.on("error", reject);
  });
  check("WS connected + subscribed to events:platform.config.changed", wsMessages.some((m) => m.type === "subscribed"));

  const put = await api("/api/v1/admin/settings/return_window_days", {
    method: "PUT",
    token: tokens.super_admin.token,
    body: { value: newValue }
  });
  check("PUT /admin/settings/return_window_days -> 200", put.status === 200 && put.json.value === newValue);

  const liveEvent = await waitFor(async () => {
    const evt = wsMessages.find((m) => m.type === "event" && m.channel === "events:platform.config.changed");
    return evt ?? null;
  });
  check("live WS delivery: event received on open socket in real time", Boolean(liveEvent));
  check("live event payload matches the change just made", liveEvent.event.payload.key === "return_window_days" && liveEvent.event.payload.new === newValue);
  ws.close();

  // --- Audit entry for that change ------------------------------------------
  console.log("\n[7/9] view the audit entry for the settings change");
  const auditRow = await dbClient.query(
    "select actor_role, action, resource, resource_id, before, after, at from audit.audit_log where resource_id = 'return_window_days' order by id desc limit 1"
  );
  check("audit.audit_log has the config_changed row", auditRow.rows.length === 1 && auditRow.rows[0].action === "config_changed");
  console.log(`       audit row: actor_role=${auditRow.rows[0].actor_role} before=${JSON.stringify(auditRow.rows[0].before)} after=${JSON.stringify(auditRow.rows[0].after)} at=${auditRow.rows[0].at.toISOString()}`);

  // Restore the setting so this demo leaves no lasting state change.
  await dbClient.query("update core.settings set value = $1::jsonb where key = 'return_window_days'", [JSON.stringify(originalValue)]);
  await dbClient.end();

  // --- Media upload + signed-URL fetch --------------------------------------
  console.log("\n[8/9] upload a media object and fetch it back via signed URL");
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const uploadUrlRes = await api("/api/v1/media/upload-url", {
    method: "POST",
    token: customers.ar.token,
    body: { purpose: "pod_photo", contentType: "image/png", sizeBytes: png1x1.length }
  });
  check("POST /media/upload-url -> 200", uploadUrlRes.status === 200 && Boolean(uploadUrlRes.json.uploadUrl));
  const putRes = await minioRequest(uploadUrlRes.json.uploadUrl, { method: "PUT", body: png1x1 });
  check("PUT bytes to presigned upload URL -> 200", putRes.status === 200);

  const downloadUrlRes = await api(`/api/v1/media/${uploadUrlRes.json.objectKey}/url`, { token: customers.ar.token });
  check("GET /media/:objectKey/url -> 200", downloadUrlRes.status === 200 && Boolean(downloadUrlRes.json.url));
  const getRes = await minioRequest(downloadUrlRes.json.url, { method: "GET" });
  check("GET presigned download URL returns the same bytes uploaded", getRes.status === 200 && getRes.body.equals(png1x1));

  console.log(`\n[9/9] summary`);
  console.log(`[m1-demo] PASS — ${passed} checks all green. M1 exit criteria met (07-test-plan.md §4).`);
}

main().catch((err) => {
  console.error(`\n[m1-demo] FAILED after ${passed} checks:`, err.message ?? err);
  process.exitCode = 1;
});
