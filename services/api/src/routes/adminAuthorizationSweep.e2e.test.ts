import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// A systematic sweep (session 2, 2026-08-08), triggered by finding the same
// defect class twice while wiring UI for adminGovernance.ts's PDPL family
// and adminFleet.ts's reassignment route: several `requirePermission(action,
// resource)` pairs are ALSO granted to a non-admin role for a legitimately
// narrower reason (04-roles §3 — a customer reading/updating their OWN
// order, a supplier reading their OWN credit data, a customer/supplier/
// driver browsing the catalog), and the admin-only route sharing that same
// coarse permission had no additional role check. Every case below was
// confirmed by direct read of services/api/src/authz.ts's matrix and the
// route handler before being listed here — this is the proof each one is
// now actually closed, driven through the real HTTP routes with a real,
// lower-privileged bearer token, not asserted.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010
const BOGUS_ID = "00000000-0000-0000-0000-000000000099";

describe("Admin routes with a shared coarse permission genuinely refuse the narrower role", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let adminToken: string;
  let customerToken: string;
  let supplierToken: string;

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54359);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-admin-authz-sweep-e2e-"));
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

    const login = async (email: string) =>
      (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: DEV_PASSWORD } })).json()
        .accessToken;

    adminToken = await login("admin.seed@petrospecial.internal");
    customerToken = await login("customer.seed@petrospecial.internal");
    supplierToken = await login("supplier.seed@petrospecial.internal");
  }, 90_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    if (dir) rmSync(dir, { recursive: true, force: true });
    await pg?.stop();
  });

  const casesForbiddenToSupplier: Array<[string, string, string]> = [
    ["GET", "/api/v1/admin/suppliers", "EP-AC-020"],
    ["GET", "/api/v1/admin/dual-control", "dual-control list"],
    ["GET", "/api/v1/admin/finance/receivables", "EP-AC-070"],
    ["GET", "/api/v1/admin/finance/verification-queue", "EP-AC-071"],
    ["GET", "/api/v1/admin/finance/custody", "EP-AC-075"]
  ];

  it.each(casesForbiddenToSupplier)("%s %s (%s): refuses a supplier", async (method, url) => {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${supplierToken}` } });
    expect(res.statusCode).toBe(403);
  });

  it("PUT /admin/suppliers/{id}/tier: refuses a supplier acting on an arbitrary supplier id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/suppliers/${BOGUS_ID}/tier`,
      headers: { authorization: `Bearer ${supplierToken}` },
      payload: { tier: "gold", reason: "self-promotion" }
    });
    expect(res.statusCode).toBe(403);
  });

  const casesForbiddenToCustomer: Array<[string, string, string]> = [
    ["POST", `/api/v1/admin/orders/${BOGUS_ID}/cancel`, "EP-AC-041 force-cancel"],
    ["POST", `/api/v1/admin/orders/${BOGUS_ID}/address`, "EP-AC-042 address edit"],
    ["POST", `/api/v1/admin/reviews/${BOGUS_ID}/moderate`, "EP-AC-044 review moderation"],
    ["POST", `/api/v1/admin/orders/${BOGUS_ID}/ready-for-pickup`, "ready-for-pickup"]
  ];

  it.each(casesForbiddenToCustomer)("%s %s (%s): refuses a customer", async (method, url) => {
    const res = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${customerToken}` },
      payload: { reasonCode: "other_with_note", note: "x", addressSnapshot: {}, action: "hide", decision: "approve" }
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /admin/catalog/skus: refuses a customer, a supplier, and succeeds for an admin", async () => {
    const asCustomer = await app.inject({
      method: "GET",
      url: "/api/v1/admin/catalog/skus",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(asCustomer.statusCode).toBe(403);

    const asSupplier = await app.inject({
      method: "GET",
      url: "/api/v1/admin/catalog/skus",
      headers: { authorization: `Bearer ${supplierToken}` }
    });
    expect(asSupplier.statusCode).toBe(403);

    const asAdmin = await app.inject({
      method: "GET",
      url: "/api/v1/admin/catalog/skus",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(asAdmin.statusCode).toBe(200);
  });

  it("every route above still answers a real admin with something other than 403", async () => {
    // Not a full behavioural test of each route (several already have their
    // own e2e coverage elsewhere) — just confirms this sweep's fix didn't
    // accidentally lock admins out too. NOT_FOUND/CONFLICT/422 on a bogus id
    // are all fine; 403 is the one status that must never appear here.
    const adminChecks: Array<[string, string]> = [
      ["GET", "/api/v1/admin/suppliers"],
      ["GET", "/api/v1/admin/dual-control"],
      ["GET", "/api/v1/admin/finance/receivables"],
      ["GET", "/api/v1/admin/finance/verification-queue"],
      ["GET", "/api/v1/admin/finance/custody"],
      ["GET", "/api/v1/admin/catalog/skus"]
    ];
    for (const [method, url] of adminChecks) {
      const res = await app.inject({ method, url, headers: { authorization: `Bearer ${adminToken}` } });
      expect(res.statusCode).not.toBe(403);
    }

    const postChecks: Array<[string, Record<string, unknown>]> = [
      [`/api/v1/admin/orders/${BOGUS_ID}/cancel`, { reasonCode: "other_with_note", note: "x" }],
      [`/api/v1/admin/orders/${BOGUS_ID}/address`, { reasonCode: "other_with_note", addressSnapshot: {} }],
      [`/api/v1/admin/reviews/${BOGUS_ID}/moderate`, { action: "hide", reasonCode: "other_with_note" }],
      [`/api/v1/admin/orders/${BOGUS_ID}/ready-for-pickup`, {}]
    ];
    for (const [url, payload] of postChecks) {
      const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${adminToken}` }, payload });
      expect(res.statusCode).not.toBe(403);
    }
  });

  // EP-AC-002 (session 2, 2026-08-08) — analytics:read is already
  // admin/super_admin-only in the matrix (confirmed by this sweep), so this
  // route was never the missing-role-check defect; it simply had no UI
  // caller until the admin dashboard's own bestsellers panel. First real
  // proof this ever returns a well-formed response against a real database.
  it("GET /admin/analytics/bestsellers: refuses a customer, returns a well-formed page for an admin", async () => {
    const asCustomer = await app.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/bestsellers",
      headers: { authorization: `Bearer ${customerToken}` }
    });
    expect(asCustomer.statusCode).toBe(403);

    const asAdmin = await app.inject({
      method: "GET",
      url: "/api/v1/admin/analytics/bestsellers",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(asAdmin.statusCode).toBe(200);
    const body = asAdmin.json();
    expect(typeof body.asOf).toBe("string");
    expect(Array.isArray(body.rows)).toBe(true);
  });
});
