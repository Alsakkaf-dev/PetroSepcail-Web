import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "minio";

// SF-01 (S07): only 4 of the 23 seeded SKUs have real legacy-site
// photography (0023_catalog_seed.sql's core.media_objects rows already
// declare the bucket/object_key/content_type/size_bytes for them) — this
// step uploads the matching real bytes so MinIO and the DB agree. The other
// 19 SKUs have no sku_media row at all and rely on the storefront's own
// family/grade placeholder fallback (TC-SF01-007), by design.
//
// object_key values here MUST stay byte-identical to 0023_catalog_seed.sql's
// — that agreement, not any ordering between the migrate/init containers, is
// what keeps the DB row and the MinIO object in sync.
const IMAGE_ROOT = process.env.CATALOG_IMAGE_ROOT ?? "/product-images";

const FILES = [
  { slug: "super-special-10w30", file: "10w30-1.webp", n: 1 },
  { slug: "super-special-10w30", file: "10w30-2.webp", n: 2 },
  { slug: "super-special-10w30", file: "10w30-3.webp", n: 3 },
  { slug: "super-special-20w50", file: "20w50-1.webp", n: 1 },
  { slug: "super-special-20w50", file: "20w50-2.webp", n: 2 },
  { slug: "super-special-20w50", file: "20w50-3.webp", n: 3 },
  { slug: "synthetic-special-5w30", file: "5w30-1.webp", n: 1 },
  { slug: "synthetic-special-5w30", file: "5w30-2.webp", n: 2 },
  { slug: "synthetic-special-5w30", file: "5w30-3.webp", n: 3 },
  { slug: "super-special-diesel-15w40", file: "15w40-1.jpg", n: 1 }
];

function contentTypeFor(file) {
  return file.endsWith(".jpg") ? "image/jpeg" : "image/webp";
}

export async function uploadCatalogMedia() {
  const client = new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_API_PORT ?? 9000),
    useSSL: (process.env.MINIO_USE_SSL ?? "false") === "true",
    accessKey: process.env.MINIO_ROOT_USER ?? "petrospecial",
    secretKey: process.env.MINIO_ROOT_PASSWORD ?? "petrospecial_dev_password"
  });
  const bucket = process.env.MINIO_BUCKET_MEDIA ?? "ps-media";

  for (const { slug, file, n } of FILES) {
    const objectKey = `product-image-${slug}-${n}`;
    const exists = await client.statObject(bucket, objectKey).then(
      () => true,
      () => false
    );
    if (exists) {
      console.log(`[init] catalog media "${objectKey}" already present — skipping`);
      continue;
    }
    const bytes = readFileSync(path.join(IMAGE_ROOT, file));
    await client.putObject(bucket, objectKey, bytes, bytes.length, { "Content-Type": contentTypeFor(file) });
    console.log(`[init] Uploaded catalog media "${objectKey}" (${bytes.length} bytes)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  uploadCatalogMedia().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
