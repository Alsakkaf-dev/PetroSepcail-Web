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

// Real bug caught by S07 live verification (docker compose up): a presigned
// GET URL is signed against MINIO_ENDPOINT (`minio`, the container-internal
// hostname) — resolvable inside the Docker network, but not by a real
// browser. S06's m1-acceptance-demo.mjs hit the exact same wall and worked
// around it with a Node-only custom DNS `lookup` — no equivalent exists for
// an actual customer's browser rendering an <img>. Caddyfile now proxies
// `/media/*` -> `minio:9000` (path-style, matching MinIO's own bucket/object
// layout) on the same origin as the storefront/admin console; Caddy's
// reverse_proxy sets the upstream Host header to the proxied target by
// default, so MinIO still sees the exact Host (`minio:9000`) the signature
// was computed against — only the scheme+host in the URL string need
// rewriting, the query-string signature itself is untouched.
export function toPublicMediaUrl(internalPresignedUrl: string): string {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) throw new Error("missing required env var PUBLIC_BASE_URL");
  const url = new URL(internalPresignedUrl);
  return `${base}/media${url.pathname}${url.search}`;
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
