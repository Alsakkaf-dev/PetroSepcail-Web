import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "minio";

export async function initMinioBuckets() {
  const client = new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_API_PORT ?? 9000),
    useSSL: (process.env.MINIO_USE_SSL ?? "false") === "true",
    accessKey: process.env.MINIO_ROOT_USER ?? "petrospecial",
    secretKey: process.env.MINIO_ROOT_PASSWORD ?? "petrospecial_dev_password"
  });

  const buckets = [
    process.env.MINIO_BUCKET_MEDIA ?? "ps-media",
    process.env.MINIO_BUCKET_INVOICES ?? "ps-invoices",
    process.env.MINIO_BUCKET_POD ?? "ps-pod"
  ];

  for (const bucket of buckets) {
    const exists = await client.bucketExists(bucket).catch(() => false);
    if (exists) {
      console.log(`[init] MinIO bucket "${bucket}" already present — skipping`);
      continue;
    }
    await client.makeBucket(bucket);
    console.log(`[init] Created MinIO bucket "${bucket}"`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  initMinioBuckets().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
