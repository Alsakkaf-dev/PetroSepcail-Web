import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// AC-10 (S18): the PDPL request/breach family had create-by-POST and
// advance/close-by-id since S18, but no GET list route ever existed for
// either — a real admin screen cannot discover a request or breach's id to
// act on without one. Proves the two new list routes and the new
// audit.advance_breach state machine end to end against a real Postgres,
// the same discipline every other admin route family already has.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("AC-10 PDPL requests and breach-notification list/advance routes", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let adminToken: string;
  let customerToken: string;
  let dbClient: Client;

  const CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54357);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-admin-pdpl-e2e-"));
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
    process.env.EMAIL_MODE = "onscreen";

    const { buildServer } = await import("../server.js");
    app = await buildServer();

    adminToken = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "admin.seed@petrospecial.internal", password: DEV_PASSWORD }
      })
    ).json().accessToken;
    customerToken = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "customer.seed@petrospecial.internal", password: DEV_PASSWORD }
      })
    ).json().accessToken;

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();
  }, 90_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    await dbClient?.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
    await pg?.stop();
  });

  it("EP-AC-091/095: creates a PDPL request, then the list route surfaces it", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pdpl/requests",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { subjectId: CUSTOMER_ID, kind: "access" }
    });
    expect(create.statusCode).toBe(201);
    const requestId = create.json().id;
    expect(create.json().status).toBe("received");

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/admin/pdpl/requests",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(forbidden.statusCode).toBe(403);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/pdpl/requests",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(list.statusCode).toBe(200);
    const item = list.json().items.find((i: { id: string }) => i.id === requestId);
    expect(item).toMatchObject({ subjectId: CUSTOMER_ID, kind: "access", status: "received" });

    // EP-AC-092 was already proven at the SQL/function level; this confirms
    // the list route's own id is genuinely the one advance() accepts.
    const advance = await app.inject({
      method: "POST",
      url: `/api/v1/admin/pdpl/requests/${requestId}/advance`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(advance.statusCode).toBe(200);
    expect(advance.json().status).toBe("executing");

    const listAfter = await app.inject({
      method: "GET",
      url: "/api/v1/admin/pdpl/requests",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    const itemAfter = listAfter.json().items.find((i: { id: string }) => i.id === requestId);
    expect(itemAfter.status).toBe("executing");
  });

  it("EP-AC-093/096/097: opens a breach, lists it, and advances it through the full notification lifecycle", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pdpl/breaches",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { detectedAt: new Date().toISOString(), scope: "storage bucket misconfigured" }
    });
    expect(create.statusCode).toBe(201);
    const breachId = create.json().id;
    expect(create.json().status).toBe("open");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/pdpl/breaches",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(list.statusCode).toBe(200);
    const item = list.json().items.find((i: { id: string }) => i.id === breachId);
    expect(item).toMatchObject({ scope: "storage bucket misconfigured", status: "open" });
    // notify_by is always exactly 72h after detected_at (audit.open_breach) —
    // the one figure this whole tracker exists to keep visible.
    expect(new Date(item.notifyBy).getTime() - new Date(item.detectedAt).getTime()).toBe(72 * 60 * 60 * 1000);

    // Before this session, a breach could open and then never move again -
    // no function advanced it past 'open'. Proves the full state machine.
    const toRegulator = await app.inject({
      method: "POST",
      url: `/api/v1/admin/pdpl/breaches/${breachId}/advance`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(toRegulator.json().status).toBe("regulator_notified");

    const toSubjects = await app.inject({
      method: "POST",
      url: `/api/v1/admin/pdpl/breaches/${breachId}/advance`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(toSubjects.json().status).toBe("subjects_notified");

    const toClosed = await app.inject({
      method: "POST",
      url: `/api/v1/admin/pdpl/breaches/${breachId}/advance`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(toClosed.json().status).toBe("closed");

    // Closed is terminal — advancing again is a real CONFLICT, not a silent no-op.
    const pastClosed = await app.inject({
      method: "POST",
      url: `/api/v1/admin/pdpl/breaches/${breachId}/advance`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(pastClosed.statusCode).toBe(409);
    expect(pastClosed.json().error.code).toBe("CONFLICT");

    const auditRows = await dbClient.query(
      "select action from audit.audit_log where resource_id = $1 and resource = 'audit.breach_notifications' order by at",
      [breachId]
    );
    expect(auditRows.rows.map((r) => r.action)).toEqual([
      "pdpl.breach.opened",
      "pdpl.breach.advanced",
      "pdpl.breach.advanced",
      "pdpl.breach.advanced"
    ]);
  });

  it("advancing a non-existent breach is NOT_FOUND", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pdpl/breaches/00000000-0000-0000-0000-000000000099/advance",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(res.statusCode).toBe(404);
  });
});
