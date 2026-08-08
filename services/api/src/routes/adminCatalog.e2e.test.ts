import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralPostgres, type EphemeralPostgres } from "../testHelpers/ephemeralPostgres.js";

// EP-AC-010/EP-AC-011 (session 2, 2026-08-08): POST /admin/catalog/skus and
// POST /admin/catalog/pack-sizes existed with no UI caller anywhere in
// apps/admin — an admin could change a price or a stock count but could
// never actually add a new product. This drives the exact JSON shape the
// new catalog create-product/create-pack-size forms send, through the real
// HTTP routes against a real Postgres, so a field-name mismatch between the
// UI and skuUpsertRequest/packSizeUpsertRequest fails here, not silently in
// a browser no one is watching.
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

describe("Admin catalog SKU/pack-size creation works end to end for the new console forms", () => {
  let dir: string;
  let pg: EphemeralPostgres;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let adminToken: string;
  let customerToken: string;
  let dbClient: Client;

  beforeAll(async () => {
    pg = await startEphemeralPostgres(54360);
    const dbUrl = pg.dbUrl;

    dir = mkdtempSync(path.join(tmpdir(), "ps-admin-catalog-e2e-"));
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

  it("POST /admin/catalog/skus: refuses a customer (create is admin-only in the matrix)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        slug: "test-blocked-sku",
        familyCode: "special",
        nameAr: "تجربة",
        nameEn: "Test",
        grade: "10W-30",
        application: "petrol_engine",
        productTypeAr: "زيت محرك",
        productTypeEn: "Engine oil"
      }
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /admin/catalog/skus then POST /admin/catalog/pack-sizes: the exact payload the console forms send round-trips", async () => {
    const skuRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        slug: "console-created-oil-5w30",
        familyCode: "special",
        nameAr: "زيت محرك تجريبي",
        nameEn: "Console Test Oil 5W-30",
        grade: "5W-30",
        application: "petrol_engine",
        productTypeAr: "زيت محرك صناعي",
        productTypeEn: "Synthetic engine oil"
      }
    });
    expect(skuRes.statusCode).toBe(201);
    const sku = skuRes.json();
    expect(sku.slug).toBe("console-created-oil-5w30");
    expect(sku.isActive).toBe(true);

    const dbSku = await dbClient.query("select name_ar, name_en, grade, application from catalog.skus where id = $1", [sku.id]);
    expect(dbSku.rows[0]).toMatchObject({
      name_ar: "زيت محرك تجريبي",
      name_en: "Console Test Oil 5W-30",
      grade: "5W-30",
      application: "petrol_engine"
    });

    const packRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/pack-sizes",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { skuId: sku.id, sizeLabel: "4 Liter", sizeLiters: 4 }
    });
    expect(packRes.statusCode).toBe(200);
    const packSize = packRes.json();
    expect(packSize.sizeLabel).toBe("4 Liter");
    expect(packSize.skuId).toBe(sku.id);

    // The route seeds a zero-quantity inventory row so the new pack size is
    // immediately visible on the console's price/stock table, not hidden
    // until some other action happens to create one.
    const inventory = await dbClient.query("select qty_on_hand, reserved from catalog.inventory where pack_size_id = $1", [
      packSize.id
    ]);
    expect(inventory.rows[0]).toMatchObject({ qty_on_hand: 0, reserved: 0 });

    // Now visible through the same GET the console list reads from.
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/admin/catalog/skus",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(listRes.statusCode).toBe(200);
    const row = listRes.json().items.find((i: { packSizeId: string }) => i.packSizeId === packSize.id);
    expect(row).toMatchObject({ nameAr: "زيت محرك تجريبي", sizeLabel: "4 Liter", qtyOnHand: 0 });
  });

  it("POST /admin/catalog/skus: a duplicate slug is CONFLICT, not a silent overwrite", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        slug: "console-created-oil-5w30",
        familyCode: "special",
        nameAr: "نسخة مكررة",
        nameEn: "Duplicate",
        grade: "5W-30",
        application: "petrol_engine",
        productTypeAr: "زيت محرك",
        productTypeEn: "Engine oil"
      }
    });
    expect(res.statusCode).toBe(409);
  });
});
