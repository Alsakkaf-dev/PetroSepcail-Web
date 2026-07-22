import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// SF-01/SF-02/AC-02 (S07): proves the real 23-SKU catalog seed, the public
// catalog/search API, and the admin CRUD path against a real ephemeral
// Postgres + MinIO — same docker-orchestration pattern as auth.e2e.test.ts /
// me.e2e.test.ts.
const CONTAINER = "ps-catalog-e2e-test";
const MINIO_CONTAINER = "ps-catalog-e2e-minio";
const DEV_PASSWORD = "DevSeed#12345"; // db/migrations/0010

function dockerAvailable(): boolean {
  return spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
}

function stopContainer() {
  spawnSync("docker", ["stop", CONTAINER], { stdio: "ignore" });
  spawnSync("docker", ["stop", MINIO_CONTAINER], { stdio: "ignore" });
}

async function waitForPostgres(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const client = new Client({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "test" });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres did not become ready within ${timeoutMs}ms`);
}

async function waitForHttp(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} did not become ready within ${timeoutMs}ms`);
}

describe.runIf(dockerAvailable())("Catalog + search + admin catalog CRUD (SF-01/SF-02/AC-02)", () => {
  let dir: string;
  let dbUrl: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let customerToken: string;
  let adminToken: string;
  let dbClient: Client;

  beforeAll(async () => {
    spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    execFileSync("docker", [
      "run", "--rm", "-d", "--name", CONTAINER,
      "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=test",
      "-p", "0:5432", "postgres:16-alpine"
    ]);
    const port = Number(execFileSync("docker", ["port", CONTAINER, "5432"]).toString().trim().split(":").pop());
    await waitForPostgres(port);
    dbUrl = `postgres://postgres:test@127.0.0.1:${port}/test`;

    execFileSync("npx", ["node-pg-migrate", "-m", "db/migrations", "--migration-file-language", "sql", "up"], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, DATABASE_URL: dbUrl }
    });

    spawnSync("docker", ["rm", "-f", MINIO_CONTAINER], { stdio: "ignore" });
    execFileSync("docker", [
      "run", "--rm", "-d", "--name", MINIO_CONTAINER,
      "-e", "MINIO_ROOT_USER=petrospecial", "-e", "MINIO_ROOT_PASSWORD=petrospecial_dev_password",
      "-p", "0:9000", "minio/minio:latest", "server", "/data"
    ]);
    const minioPort = Number(execFileSync("docker", ["port", MINIO_CONTAINER, "9000"]).toString().trim().split(":").pop());
    await waitForHttp(`http://127.0.0.1:${minioPort}/minio/health/live`);

    process.env.MINIO_ENDPOINT = "127.0.0.1";
    process.env.MINIO_API_PORT = String(minioPort);
    process.env.MINIO_USE_SSL = "false";
    process.env.MINIO_ROOT_USER = "petrospecial";
    process.env.MINIO_ROOT_PASSWORD = "petrospecial_dev_password";
    process.env.MINIO_BUCKET_MEDIA = "ps-media";
    process.env.MINIO_BUCKET_INVOICES = "ps-invoices";
    process.env.MINIO_BUCKET_POD = "ps-pod";
    process.env.PUBLIC_BASE_URL = "https://localhost";
    const { Client: MinioClient } = await import("minio");
    const minioAdmin = new MinioClient({
      endPoint: "127.0.0.1",
      port: minioPort,
      useSSL: false,
      accessKey: "petrospecial",
      secretKey: "petrospecial_dev_password"
    });
    for (const bucket of ["ps-media", "ps-invoices", "ps-pod"]) {
      await minioAdmin.makeBucket(bucket);
    }

    dir = mkdtempSync(path.join(tmpdir(), "ps-catalog-e2e-"));
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

    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin.seed@petrospecial.internal", password: DEV_PASSWORD }
    });
    adminToken = adminLogin.json().accessToken;

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();
  }, 90_000);

  afterAll(async () => {
    const { closePool } = await import("../db.js");
    await app?.close();
    await closePool();
    await dbClient?.end();
    rmSync(dir, { recursive: true, force: true });
    stopContainer();
  });

  it("TC-SF01-001..003: three families, DB-driven, sku counts sum to 23", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/families" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(3);
    const codes = body.items.map((f: { code: string }) => f.code);
    expect(codes).toEqual(["special", "petro", "raval"]);
    const total = body.items.reduce((sum: number, f: { skuCount: number }) => sum + f.skuCount, 0);
    expect(total).toBe(23);
  });

  it("TC-SF01-004..008: catalog lists exactly 23 SKUs, paginated 20/page with a working cursor", async () => {
    const page1 = await app.inject({ method: "GET", url: "/api/v1/catalog/products?limit=20" });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.items).toHaveLength(20);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/products?limit=20&cursor=${encodeURIComponent(body1.nextCursor)}`
    });
    const body2 = page2.json();
    expect(body2.items).toHaveLength(3);
    expect(body2.nextCursor).toBeNull();

    for (const item of [...body1.items, ...body2.items]) {
      expect(typeof item.fromPriceInclVat).toBe("string");
      expect(typeof item.anyInStock).toBe("boolean");
    }
  });

  it("TC-SF01-009..012: full 7-block datasheet, non-empty AR+EN, ten spec fields", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/products/super-special-10w30" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nameAr).toBeTruthy();
    expect(body.nameEn).toBeTruthy();
    for (const block of ["overview", "benefits", "quality", "manufacturer", "hse"] as const) {
      expect(body.blocks[block].length).toBeGreaterThan(0);
      for (const item of body.blocks[block]) {
        expect(item.ar).toBeTruthy();
        expect(item.en).toBeTruthy();
      }
    }
    expect(body.blocks.cta.headingAr).toBeTruthy();
    expect(body.blocks.cta.headingEn).toBeTruthy();
    expect(body.specs.grade).toBe("10W-30");
    expect(body.specs.apiService).toBe("API SL");
    expect(body.specs.drainKm).toBe(5000);
    expect(body.certifications.length).toBeGreaterThan(0);
  });

  it("TC-SF01-018: product images are publicly visible via a browser-reachable signed URL", async () => {
    // Regression guard for a real bug S07 caught live: core.media_objects had
    // no public-read RLS policy, so a guest's join from sku_media silently
    // returned zero media rows (0024_media_product_image_public_read.sql).
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/products/super-special-10w30" });
    const body = res.json();
    expect(body.media.length).toBe(3);
    expect(body.media[0].url).toMatch(/^https:\/\/localhost\/media\//);
  });

  it("TC-SF01-016: pack-sizes expose inStock boolean, never a raw quantity", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/products/super-special-10w30/pack-sizes" });
    expect(res.statusCode).toBe(200);
    const raw = res.payload;
    expect(raw).not.toMatch(/qtyOnHand|"reserved"/);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(typeof body.items[0].inStock).toBe("boolean");
    expect(body.items[0].inStock).toBe(true);
  });

  it("TC-SF01-013..015: displayed price is ex-VAT price × (1 + vat_rate)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/products/super-special-10w30/pack-sizes" });
    const body = res.json();
    const exVat = Number(body.items[0].priceExVat);
    const inclVat = Number(body.items[0].priceInclVat);
    expect(inclVat).toBeCloseTo(exVat * 1.15, 2);
  });

  it("TC-SF01-019: related products are same-family and exclude self", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/products/super-special-10w30/related" });
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(4);
    expect(body.items.every((i: { family: string; slug: string }) => i.family === "special" && i.slug !== "super-special-10w30")).toBe(
      true
    );
  });

  it("TC-SF02-001..004: bilingual + digit/dash-tolerant search", async () => {
    const arabic = await app.inject({ method: "GET", url: `/api/v1/catalog/search?q=${encodeURIComponent("سبيشل")}` });
    expect(arabic.json().items.length).toBeGreaterThan(0);

    const english = await app.inject({ method: "GET", url: "/api/v1/catalog/search?q=special" });
    expect(english.json().items.length).toBeGreaterThan(0);

    const withDash = await app.inject({ method: "GET", url: "/api/v1/catalog/search?q=20W-50" });
    const noDash = await app.inject({ method: "GET", url: "/api/v1/catalog/search?q=20w50" });
    const slugsWithDash = withDash.json().items.map((i: { slug: string }) => i.slug).sort();
    const slugsNoDash = noDash.json().items.map((i: { slug: string }) => i.slug).sort();
    expect(slugsWithDash.length).toBeGreaterThan(0);
    expect(slugsWithDash).toEqual(slugsNoDash);
  });

  it("TC-SF02-007: zero-result search returns an empty-state with suggestions", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/search?q=zzzznomatch" });
    const body = res.json();
    expect(body.items).toHaveLength(0);
    expect(body.suggestions.length).toBeGreaterThan(0);
  });

  it("TC-SF02-011: suggest returns a family match after 2 characters", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/catalog/suggest?q=rav" });
    const body = res.json();
    expect(body.suggestions.some((s: { type: string; label: string }) => s.type === "family" && /raval/i.test(s.label))).toBe(
      true
    );
  });

  it("TC-AC02-001: a catalog write from a non-admin role is denied", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog/skus",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: {
        slug: "should-not-exist",
        familyCode: "special",
        nameAr: "غير مصرح",
        nameEn: "unauthorized",
        grade: "1",
        application: "petrol_engine",
        productTypeAr: "x",
        productTypeEn: "x"
      }
    });
    expect(res.statusCode).toBe(403);
    const sku = await dbClient.query("select 1 from catalog.skus where slug = 'should-not-exist'");
    expect(sku.rows).toHaveLength(0);
  });

  it("TC-AC02-002/003: admin price change is audited, emits EV-PC-003, and SF sees it on next read", async () => {
    const packRes = await dbClient.query<{ id: string }>(
      `select p.id from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where s.slug = 'super-special-10w30'`
    );
    const packSizeId = packRes.rows[0]!.id;

    const before = await app.inject({ method: "GET", url: "/api/v1/catalog/products/super-special-10w30/pack-sizes" });
    const oldExVat = before.json().items[0].priceExVat;

    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog/prices",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { packSizeId, retailPrice: "99.00" }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().retailPrice).toBe("99.00");

    const after = await app.inject({ method: "GET", url: "/api/v1/catalog/products/super-special-10w30/pack-sizes" });
    expect(after.json().items[0].priceExVat).toBe("99.00");
    expect(after.json().items[0].priceExVat).not.toBe(oldExVat);

    const event = await dbClient.query(
      "select payload from core.outbox where name = 'catalog.price.changed' order by occurred_at desc limit 1"
    );
    expect(event.rows[0].payload.pack_size_id).toBe(packSizeId);
    expect(event.rows[0].payload.new).toBe("99.00");

    const audit = await dbClient.query(
      "select 1 from audit.audit_log where action = 'price_changed' and resource_id = $1",
      [packSizeId]
    );
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("TC-AC02-004: hub stock crossing zero emits EV-PC-004; a restock emits EV-PC-005", async () => {
    const packRes = await dbClient.query<{ id: string }>(
      `select p.id from catalog.pack_sizes p join catalog.skus s on s.id = p.sku_id where s.slug = 'gear-atf'`
    );
    const packSizeId = packRes.rows[0]!.id;

    const zeroOut = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog/inventory",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { packSizeId, qtyOnHand: 0 }
    });
    expect(zeroOut.statusCode).toBe(200);
    const stockoutEvent = await dbClient.query(
      "select 1 from core.outbox where name = 'catalog.inventory.stockout' and (payload->>'pack_size_id') = $1",
      [packSizeId]
    );
    expect(stockoutEvent.rows.length).toBeGreaterThan(0);

    const availability = await dbClient.query("select in_stock from catalog.v_sku_availability where pack_size_id = $1", [
      packSizeId
    ]);
    expect(availability.rows[0].in_stock).toBe(false);

    const restock = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/catalog/inventory",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { packSizeId, qtyOnHand: 50 }
    });
    expect(restock.statusCode).toBe(200);
    const restockEvent = await dbClient.query(
      "select 1 from core.outbox where name = 'catalog.inventory.restocked' and (payload->>'pack_size_id') = $1",
      [packSizeId]
    );
    expect(restockEvent.rows.length).toBeGreaterThan(0);

    const movements = await dbClient.query("select kind, qty from catalog.stock_movements where pack_size_id = $1 order by created_at", [
      packSizeId
    ]);
    expect(movements.rows.length).toBeGreaterThanOrEqual(2);
    expect(movements.rows.every((r: { kind: string }) => r.kind === "adjust")).toBe(true);
  });
});
