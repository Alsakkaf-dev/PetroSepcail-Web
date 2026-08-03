"use client";

import type { UploadUrlResponse } from "@petrospecial/contracts";
import { authedFetch } from "./authClient";

// EP-PC-050/051 (PC-09) real upload flow: request a presigned PUT URL,
// PUT the file bytes straight to it (no bearer token on that hop — the
// short-lived signed URL itself is the credential, same as any S3-style
// presigned upload), then hand back the objectKey every purpose-specific
// endpoint already expects as the media id. Replaces the placeholder
// "paste an already-uploaded media id" input this screen used to have.
export type MediaPurpose = "pod_photo" | "product_image" | "invoice" | "transfer_proof";

export async function uploadFile(file: File, purpose: MediaPurpose): Promise<string> {
  const { uploadUrl, objectKey } = await authedFetch<UploadUrlResponse>("/api/v1/media/upload-url", {
    method: "POST",
    body: JSON.stringify({ purpose, contentType: file.type, sizeBytes: file.size })
  });
  const res = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return objectKey;
}
