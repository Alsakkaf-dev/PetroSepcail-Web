// Shared E2E test helper: a real, throwaway S3-compatible object store,
// replacing the minio/minio Docker container (D-15 hosting pivot retired
// Docker from this project). The app's real client (media/minioClient.ts)
// is the `minio` SDK talking plain S3 v4 signed HTTP — s3rver implements
// enough of that surface (buckets, put/get object, presigned URLs) to be a
// drop-in target, no code path in the app needs to change.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import S3rver from "s3rver";
import { Client as MinioClient } from "minio";

export interface EphemeralMinio {
  port: number;
  accessKey: string;
  secretKey: string;
  stop: () => Promise<void>;
}

const BUCKETS = ["ps-media", "ps-invoices", "ps-pod"];

export async function startEphemeralMinio(port: number): Promise<EphemeralMinio> {
  const dataDir = mkdtempSync(join(tmpdir(), "ps-e2e-s3-"));
  const accessKey = "S3RVER";
  const secretKey = "S3RVER";

  const server = new S3rver({
    address: "127.0.0.1",
    port,
    silent: true,
    directory: dataDir,
    // s3rver's fixed S3RVER/S3RVER credential pair is a stand-in for
    // whatever MINIO_ROOT_USER/PASSWORD the caller configures the `minio`
    // SDK client with — this accepts any well-formed signature rather than
    // validating the exact key, so the caller's own env values still work.
    allowMismatchedSignatures: true
  });
  await server.run();

  const admin = new MinioClient({ endPoint: "127.0.0.1", port, useSSL: false, accessKey, secretKey });
  for (const bucket of BUCKETS) {
    await admin.makeBucket(bucket);
  }

  return {
    port,
    accessKey,
    secretKey,
    stop: async () => {
      await server.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}
