import { Client } from "minio";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

// Same construction pattern as scripts/init/init-minio-buckets.mjs (S00) —
// self-hosted MinIO, no vendor account (D-12). Unlike that script (which
// lives outside parity-grep's scanned roots and can afford dev-friendly
// fallback defaults), this is application source: every value comes from
// .env, no fallback literal that could silently paper over a missing env
// var in a real deployment (D-13).
let client: Client | undefined;

export function getMinioClient(): Client {
  client ??= new Client({
    endPoint: requireEnv("MINIO_ENDPOINT"),
    port: Number(requireEnv("MINIO_API_PORT")),
    useSSL: requireEnv("MINIO_USE_SSL") === "true",
    accessKey: requireEnv("MINIO_ROOT_USER"),
    secretKey: requireEnv("MINIO_ROOT_PASSWORD")
  });
  return client;
}

export type MediaPurpose = "product_image" | "pod_photo" | "invoice" | "transfer_proof";

// core.media_objects.purpose comment (04-database-design §3.10):
// "product_image|pod_photo|invoice|transfer_proof". Bucket-per-purpose-
// family, matching scripts/init/init-minio-buckets.mjs's 3 buckets.
export function bucketForPurpose(purpose: MediaPurpose): string {
  switch (purpose) {
    case "pod_photo":
      return requireEnv("MINIO_BUCKET_POD");
    case "invoice":
      return requireEnv("MINIO_BUCKET_INVOICES");
    case "product_image":
    case "transfer_proof":
      return requireEnv("MINIO_BUCKET_MEDIA");
  }
}
