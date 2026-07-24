import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";
import { startEphemeralMinio, type EphemeralMinio } from "../testHelpers/ephemeralMinio.js";

// PC-GW-3's actual point: prove RLS is enforced through the real API path
// (JWT -> gateway actor resolution -> app_user + `set local
// request.jwt.claims` -> RLS policy), not just directly in SQL — S01's
// scripts/test-rls.mjs already proved the SQL side.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("GET /api/v1/me — RLS enforced through the API path (PC-GW-3)", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  let minio: EphemeralMinio;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let customerToken: string;
  let supplierToken: string;
  let adminToken: string;
  let superAdminToken: string;
  let dbClient: Client;

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54347);
    const dbUrl = pg.dbUrl;

    // PC-09: real S3-compatible storage for the media upload/download tests.
    minio = await startEphemeralMinio(54348);

    process.env.MINIO_ENDPOINT = "127.0.0.1";
    process.env.MINIO_API_PORT = String(minio.port);
    process.env.MINIO_USE_SSL = "false";
    process.env.MINIO_ROOT_USER = minio.accessKey;
    process.env.MINIO_ROOT_PASSWORD = minio.secretKey;
    process.env.MINIO_BUCKET_MEDIA = "ps-media";
    process.env.MINIO_BUCKET_INVOICES = "ps-invoices";
    process.env.MINIO_BUCKET_POD = "ps-pod";

    dir = mkdtempSync(path.join(tmpdir(), "ps-me-e2e-"));
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    writeFileSync(path.join(dir, "jwt_private.pem"), privateKey);
    writeFileSync(path.join(dir, "jwt_public.pem"), publicKey);
    writeFileSync(path.join(dir, "mfa.key"), randomBytes(32).toString("base64"));

    process.env.DATABASE_URL = dbUrl;
    process.env.JWT_PRIVATE_KEY_PATH = path.join(dir, "jwt_private.pem");
    process.env.JWT_PUBLIC_KEY_PATH = path.join(dir, "jwt_public.pem");
    process.env.MFA_ENCRYPTION_KEY_PATH = path.join(dir, "mfa.key");
    process.env.JWT_ACCESS_TTL_SECONDS = "3600";
    process.env.JWT_REFRESH_TTL_SECONDS = "2592000";

    const { buildServer } = await import("../server.js");
    app = await buildServer();

    const customerLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "customer.seed@petrospecial.internal", password: DEV_PASSWORD }
    });
    customerToken = customerLogin.json().accessToken;

    const supplierLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "supplier.seed@petrospecial.internal", password: DEV_PASSWORD }
    });
    supplierToken = supplierLogin.json().accessToken;

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin.seed@petrospecial.internal", password: DEV_PASSWORD }
    });
    adminToken = adminLogin.json().accessToken;

    const superAdminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "superadmin.seed@petrospecial.internal", password: DEV_PASSWORD }
    });
    superAdminToken = superAdminLogin.json().accessToken;

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();
  }, 60_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    await dbClient?.end();
    rmSync(dir, { recursive: true, force: true });
    await minio?.stop();
    await pg?.stop();
  });

  it("returns the caller's own identity, not a static/cached value", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${customerToken}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(body.email).toBe("customer.seed@petrospecial.internal");
    expect(body.roles).toEqual(["customer"]);
  });

  it("a different caller gets a different, correctly-scoped identity through the same route", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${supplierToken}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe("00000000-0000-0000-0000-000000000002");
    expect(body.email).toBe("supplier.seed@petrospecial.internal");
    expect(body.roles).toEqual(["supplier"]);
  });

  it("rejects a request with no Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a garbage bearer token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: "Bearer not-a-real-token" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("RLS restricts an unfiltered query to exactly one row, even with no WHERE clause (the real proof)", async () => {
    const { withRlsTransaction } = await import("../db.js");
    const { verifyAccessToken } = await import("../security/jwt.js");
    const actor = await verifyAccessToken(customerToken);

    const count = await withRlsTransaction(actor, async (client) => {
      // Deliberately no WHERE clause — if this returns more than 1, RLS
      // isn't actually doing the filtering and something is badly wrong.
      const res = await client.query<{ n: number }>("select count(*)::int as n from core.identities");
      return res.rows[0]!.n;
    });
    expect(count).toBe(1);
  });

  // EP-PC-030 (PC-07, S05) — same server/DB as the /me tests above, no
  // reason to pay for a second docker spin-up in its own suite.
  it("GET /api/v1/i18n/ar returns the AR bundle for guests, no auth required", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/i18n/ar" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.locale).toBe("ar");
    expect(body.strings["nav.home"]).toBe("الرئيسية");
  });

  it("GET /api/v1/i18n/en returns the EN bundle", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/i18n/en" });
    expect(res.statusCode).toBe(200);
    expect(res.json().strings["nav.home"]).toBe("Home");
  });

  it("GET /api/v1/i18n/fr rejects an unsupported locale", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/i18n/fr" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  // EP-PC-040..043 (PC-12, S05) — same server/DB, appended for the same
  // reason as the i18n tests above.
  it("GET /api/v1/admin/settings is readable by admin and lists the S01 seed", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/settings",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(200);
    const vatRate = res.json().find((s: { key: string }) => s.key === "vat_rate");
    expect(vatRate.value).toBe(0.15);
  });

  it("GET /api/v1/admin/settings is forbidden for a customer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/settings",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("PUT /api/v1/admin/settings/:key is forbidden for admin (super_admin-only, see route comment)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/settings/vat_rate",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { value: 0.16 }
    });
    expect(res.statusCode).toBe(403);
  });

  it("PUT /api/v1/admin/settings/:key by super_admin updates the value, audits it, and emits EV-PC-050", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/settings/vat_rate",
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { value: 0.16 }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().value).toBe(0.16);

    const audit = await dbClient.query(
      "select action, resource, resource_id, before, after from audit.audit_log where resource = 'core.settings' and resource_id = 'vat_rate'"
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].before).toBe(0.15);
    expect(audit.rows[0].after).toBe(0.16);

    const event = await dbClient.query("select payload from core.outbox where name = 'platform.config.changed'");
    expect(event.rowCount).toBe(1);
    expect(event.rows[0].payload).toEqual({ key: "vat_rate", old: 0.15, new: 0.16 });

    // Restore, so this test is independent of later ones in the same file.
    await dbClient.query("update core.settings set value = '0.15' where key = 'vat_rate'");
  });

  it("PUT /api/v1/admin/feature-flags/:key by super_admin updates a flag", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/feature-flags/sms.enabled",
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { value: true }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().value).toBe(true);
  });

  it("PUT on a non-existent settings key returns NOT_FOUND", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/settings/does_not_exist",
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { value: 1 }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  // EP-PC-020..022 (PC-06, S05) — same server/DB, appended for the same
  // reason as the i18n/config tests above.
  it("in-app notifications: list, unread filter, mark one read, mark all read, RLS isolation", async () => {
    const customerId = "00000000-0000-0000-0000-000000000001";
    const supplierId = "00000000-0000-0000-0000-000000000002";
    await dbClient.query(
      `insert into core.notifications (identity_id, type, params) values
         ($1, 'test.one', '{}'::jsonb), ($1, 'test.two', '{}'::jsonb), ($2, 'test.other', '{}'::jsonb)`,
      [customerId, supplierId]
    );

    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(list.items).toHaveLength(2); // RLS: never sees the supplier's row
    expect(list.items.every((n: { type: string }) => n.type.startsWith("test."))).toBe(true);

    const unreadRes = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?unread=true",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(unreadRes.json().items).toHaveLength(2);

    const toMarkRead = list.items[0].id;
    const markOneRes = await app.inject({
      method: "POST",
      url: `/api/v1/notifications/${toMarkRead}/read`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(markOneRes.statusCode).toBe(204);

    const afterOneRead = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?unread=true",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(afterOneRead.json().items).toHaveLength(1);

    const readAllRes = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/read-all",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(readAllRes.statusCode).toBe(204);

    const afterReadAll = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?unread=true",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(afterReadAll.json().items).toHaveLength(0);

    // A customer marking the supplier's own notification "read" affects
    // nothing (RLS `notif_own_update` scopes the WHERE regardless of id).
    const supplierNotif = await dbClient.query("select id from core.notifications where identity_id = $1", [supplierId]);
    await app.inject({
      method: "POST",
      url: `/api/v1/notifications/${supplierNotif.rows[0].id}/read`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    const stillUnread = await dbClient.query("select read_at from core.notifications where id = $1", [
      supplierNotif.rows[0].id
    ]);
    expect(stillUnread.rows[0].read_at).toBeNull();
  });

  it("cursor pagination on GET /api/v1/notifications returns a working nextCursor", async () => {
    const customerId = "00000000-0000-0000-0000-000000000001";
    await dbClient.query("delete from core.notifications where identity_id = $1", [customerId]);
    for (let i = 0; i < 3; i++) {
      await dbClient.query("insert into core.notifications (identity_id, type, params) values ($1, $2, '{}'::jsonb)", [
        customerId,
        `page.${i}`
      ]);
    }

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=2",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(firstPage.json().items).toHaveLength(2);
    expect(firstPage.json().nextCursor).not.toBeNull();

    const secondPage = await app.inject({
      method: "GET",
      url: `/api/v1/notifications?limit=2&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(secondPage.json().items).toHaveLength(1);
    expect(secondPage.json().nextCursor).toBeNull();

    const firstIds = firstPage.json().items.map((n: { id: string }) => n.id);
    const secondIds = secondPage.json().items.map((n: { id: string }) => n.id);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toHaveLength(0); // no overlap
  });

  // EP-PC-050/051 (PC-09, S05) — real MinIO, same server/DB as the tests above.
  it("full round trip: presigned PUT actually uploads, presigned GET downloads the same bytes", async () => {
    const uploadUrlRes = await app.inject({
      method: "POST",
      url: "/api/v1/media/upload-url",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { purpose: "product_image", contentType: "image/png", sizeBytes: 4 }
    });
    expect(uploadUrlRes.statusCode).toBe(200);
    const { uploadUrl, objectKey } = uploadUrlRes.json();

    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes, as a stand-in payload
    const putRes = await fetch(uploadUrl, { method: "PUT", body: bytes });
    expect(putRes.ok).toBe(true);

    const downloadUrlRes = await app.inject({
      method: "GET",
      url: `/api/v1/media/${objectKey}/url`,
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(downloadUrlRes.statusCode).toBe(200);
    const { url, expiresIn } = downloadUrlRes.json();
    expect(expiresIn).toBe(3600);

    const downloaded = await fetch(url);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
  });

  it("rejects an upload request with a disallowed content type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/media/upload-url",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { purpose: "product_image", contentType: "application/exe", sizeBytes: 100 }
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an oversized upload request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/media/upload-url",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { purpose: "pod_photo", contentType: "image/jpeg", sizeBytes: 999_999_999 }
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.field).toBe("sizeBytes");
  });

  it("a different (non-owner, non-admin) user cannot get a download URL for someone else's object (RLS)", async () => {
    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/v1/media/upload-url",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { purpose: "product_image", contentType: "image/png", sizeBytes: 4 }
    });
    const { objectKey } = uploadRes.json();

    const asSupplier = await app.inject({
      method: "GET",
      url: `/api/v1/media/${objectKey}/url`,
      headers: { authorization: `Bearer ${supplierToken}` }
    });
    expect(asSupplier.statusCode).toBe(404); // RLS-invisible, not FORBIDDEN — no ownership leakage

    const asAdmin = await app.inject({
      method: "GET",
      url: `/api/v1/media/${objectKey}/url`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(asAdmin.statusCode).toBe(200); // migration 0014: admin/super_admin can read any object
  });
});
