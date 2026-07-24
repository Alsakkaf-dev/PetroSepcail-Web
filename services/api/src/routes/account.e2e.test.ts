import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// SF-10 (S09): profile edit (EP-PC-012), account overview/loyalty stub,
// notification preferences, consents, PDPL export.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("Account (SF-10)", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let customerToken: string;
  let dbClient: Client;

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54351);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-account-e2e-"));
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
    rmSync(dir, { recursive: true, force: true });
    await pg?.stop();
  });

  it("FR-SF10-001: PATCH /me updates fullName/phone/locale, leaves email untouched", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { fullName: "Updated Name", locale: "en" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fullName).toBe("Updated Name");
    expect(body.locale).toBe("en");
    expect(body.email).toBe("customer.seed@petrospecial.internal"); // untouched
  });

  it("FR-SF10-005: notification preferences default to absent (enabled), can be overridden", async () => {
    const empty = await app.inject({
      method: "GET",
      url: "/api/v1/account/notification-preferences",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(empty.json().items).toEqual([]);

    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/account/notification-preferences",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { items: [{ notificationType: "order.status_changed", channel: "sms", enabled: false }] }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().items).toEqual([{ notificationType: "order.status_changed", channel: "sms", enabled: false }]);
  });

  it("in_app is not an acceptable channel for a preference override (always on)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/account/notification-preferences",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { items: [{ notificationType: "order.status_changed", channel: "in_app", enabled: false }] }
    });
    expect(res.statusCode).toBe(422); // zod rejects — channel enum excludes in_app
  });

  it("FR-SF10-006: consents — withdrawing marketing writes a new ledger row, keeps history", async () => {
    await dbClient.query(
      `insert into core.consents (identity_id, kind, granted, policy_version) values
         ('00000000-0000-0000-0000-000000000001', 'service_terms', true, '1.0'),
         ('00000000-0000-0000-0000-000000000001', 'marketing', true, '1.0')`
    );

    const before = await app.inject({
      method: "GET",
      url: "/api/v1/account/consents",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(before.json().items.find((c: { kind: string }) => c.kind === "marketing").granted).toBe(true);

    const withdraw = await app.inject({
      method: "PATCH",
      url: "/api/v1/account/consents",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { marketing: false }
    });
    expect(withdraw.statusCode).toBe(204);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/account/consents",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(after.json().items.find((c: { kind: string }) => c.kind === "marketing").granted).toBe(false);
    expect(after.json().items.find((c: { kind: string }) => c.kind === "service_terms").granted).toBe(true); // untouched

    const ledgerRows = await dbClient.query(
      "select count(*)::int as n from core.consents where identity_id = $1 and kind = 'marketing'",
      ["00000000-0000-0000-0000-000000000001"]
    );
    expect(ledgerRows.rows[0].n).toBe(2); // append-only — original grant + withdrawal, never mutated in place
  });

  it("FR-SF10-004: loyalty is a documented zero-balance stub until LE-01 (S19)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/account/loyalty",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ balance: 0, redeemRate: { points: 100, sar: 5 }, entries: [] });
  });

  it("account overview reflects real address count and recent orders", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/me/addresses",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { recipientName: "T", phone: "+966500000009", line1: "L1", city: "Jeddah" }
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/account/overview",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().addressCount).toBeGreaterThanOrEqual(1);
    expect(res.json().pointsBalance).toBe(0);
  });

  it("FR-SF10-008: account export returns the caller's own identity/addresses/orders, synchronously", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/account/export",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.identity.email).toBe("customer.seed@petrospecial.internal");
    expect(Array.isArray(body.addresses)).toBe(true);
    expect(Array.isArray(body.orders)).toBe(true);
  });
});
