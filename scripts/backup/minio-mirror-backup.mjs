#!/usr/bin/env node
// PC-11 (FR-PC11-001/TC-PC11-003): T1 MinIO backup — mirrors every object in
// each of the 3 buckets from `scripts/init/init-minio-buckets.mjs` down to
// `backups/minio/<bucket>/` on the host, one-way (remote -> local), using the
// same `minio` SDK + env-var connection pattern as the init script (no new
// binary dependency — an `mc` CLI container isn't part of this compose
// stack, D-12 self-contained). This is additive-only (never deletes a local
// file whose remote object was removed) — sufficient for backup purposes
// since this platform never deletes media/invoice/POD objects in place.
//
// `--restore` reverses the direction: uploads every locally-backed-up file
// back into its bucket (creating the bucket first if missing). This is the
// MinIO leg of `ops/dr-runbook.md`'s restore procedure (TC-PC11-003).
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "minio";

const BACKUP_DIR = path.resolve("backups/minio");

function minioClient() {
  return new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_API_PORT ?? 9000),
    useSSL: (process.env.MINIO_USE_SSL ?? "false") === "true",
    accessKey: process.env.MINIO_ROOT_USER ?? "petrospecial",
    secretKey: process.env.MINIO_ROOT_PASSWORD ?? "petrospecial_dev_password"
  });
}

function buckets() {
  return [
    process.env.MINIO_BUCKET_MEDIA ?? "ps-media",
    process.env.MINIO_BUCKET_INVOICES ?? "ps-invoices",
    process.env.MINIO_BUCKET_POD ?? "ps-pod"
  ];
}

async function listObjectKeys(client, bucket) {
  const exists = await client.bucketExists(bucket).catch(() => false);
  if (!exists) return [];
  return await new Promise((resolve, reject) => {
    const keys = [];
    const stream = client.listObjectsV2(bucket, "", true);
    stream.on("data", (obj) => keys.push(obj.name));
    stream.on("end", () => resolve(keys));
    stream.on("error", reject);
  });
}

async function backupBucket(client, bucket) {
  const keys = await listObjectKeys(client, bucket);
  const bucketDir = path.join(BACKUP_DIR, bucket);
  for (const key of keys) {
    const destPath = path.join(bucketDir, ...key.split("/"));
    mkdirSync(path.dirname(destPath), { recursive: true });
    await client.fGetObject(bucket, key, destPath);
  }
  return keys.length;
}

function listLocalFiles(dir, base = dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listLocalFiles(full, base, files);
    } else {
      files.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return files;
}

async function restoreBucket(client, bucket) {
  const bucketDir = path.join(BACKUP_DIR, bucket);
  const keys = listLocalFiles(bucketDir);
  if (keys.length === 0) return 0;

  const exists = await client.bucketExists(bucket).catch(() => false);
  if (!exists) {
    await client.makeBucket(bucket);
    console.log(`[backup:minio] created missing bucket "${bucket}"`);
  }

  for (const key of keys) {
    const srcPath = path.join(bucketDir, ...key.split("/"));
    await client.putObject(bucket, key, createReadStream(srcPath), statSync(srcPath).size);
  }
  return keys.length;
}

async function main() {
  const restoreMode = process.argv.includes("--restore");
  const client = minioClient();

  try {
    await client.listBuckets();
  } catch (err) {
    console.error("[backup:minio] cannot reach MinIO — is the `minio` service running?", err.message ?? err);
    process.exit(1);
  }

  let total = 0;
  for (const bucket of buckets()) {
    const count = restoreMode ? await restoreBucket(client, bucket) : await backupBucket(client, bucket);
    console.log(`[backup:minio] ${restoreMode ? "restored" : "mirrored"} ${count} object(s) ${restoreMode ? "into" : "from"} "${bucket}"`);
    total += count;
  }

  console.log(`[backup:minio] ${restoreMode ? "restore" : "backup"} complete — ${total} object(s) total, dir: ${BACKUP_DIR}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[backup:minio] failed:", err.message ?? err);
    process.exitCode = 1;
  });
}
