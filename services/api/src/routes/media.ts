import { randomUUID } from "node:crypto";
import { downloadUrlResponse, uploadUrlRequest, uploadUrlResponse } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withRlsTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { bucketForPurpose, getMinioClient } from "../media/minioClient.js";
import { validateUpload } from "../media/uploadRules.js";

// EP-PC-050/051 (PC-09, S05). No presigned-URL expiry is specified for
// upload (only the download side: FR-PC09-002 "time-limited signed URLs (60
// min)", matching EP-PC-051's literal {expiresIn:3600}) — 15 min for the
// upload window is a reasonable [BUSINESS-CONFIRM]-adjacent default, not
// spec-given.
const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;
const DOWNLOAD_URL_EXPIRY_SECONDS = 3600;

export function registerMediaRoutes(app: FastifyInstance): void {
  // EP-PC-050 · POST /media/upload-url · auth
  app.post("/api/v1/media/upload-url", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");
    const body = uploadUrlRequest.parse(request.body);

    const validationError = validateUpload(body.purpose, body.contentType, body.sizeBytes);
    if (validationError) throw new ApiError("VALIDATION_ERROR", validationError);

    const bucket = bucketForPurpose(body.purpose);
    // No internal "/" — EP-PC-051's own path is `/media/{objectKey}/url`,
    // and a slash-bearing key would make that route unparseable.
    const objectKey = `${body.purpose}-${randomUUID()}`;
    const uploadUrl = await getMinioClient().presignedPutObject(bucket, objectKey, UPLOAD_URL_EXPIRY_SECONDS);

    // FR-PC09-003 note (SPEC-GAP, see uploadRules.ts): a bare presigned PUT
    // can't enforce contentType/sizeBytes at the storage layer the way a
    // presigned POST policy could — EP-PC-051's literal 3-field response
    // shape rules out the POST-policy flow. What's recorded here is the
    // DECLARED contentType/sizeBytes (validated against uploadRules.ts),
    // not a value MinIO independently verified against the actual bytes.
    await withRlsTransaction(actor, async (client) => {
      await client.query(
        `insert into core.media_objects (bucket, object_key, content_type, size_bytes, uploaded_by, purpose)
         values ($1, $2, $3, $4, $5, $6)`,
        [bucket, objectKey, body.contentType, body.sizeBytes, actor.sub, body.purpose]
      );
    });

    return reply
      .code(200)
      .send(uploadUrlResponse.parse({ uploadUrl, objectKey, expiresIn: UPLOAD_URL_EXPIRY_SECONDS }));
  });

  // EP-PC-051 · GET /media/{objectKey}/url · auth
  app.get<{ Params: { objectKey: string } }>("/api/v1/media/:objectKey/url", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");

    // RLS (media_self_read OR media_admin_read, migration 0014) scopes this
    // to "owner or admin/super_admin" exactly per "authorized by
    // ownership/role" — no application-level ownership check needed.
    const row = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ bucket: string; object_key: string }>(
        "select bucket, object_key from core.media_objects where object_key = $1",
        [request.params.objectKey]
      );
      return res.rows[0];
    });
    if (!row) throw new ApiError("NOT_FOUND");

    const url = await getMinioClient().presignedGetObject(row.bucket, row.object_key, DOWNLOAD_URL_EXPIRY_SECONDS);
    return reply.code(200).send(downloadUrlResponse.parse({ url, expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS }));
  });
}
