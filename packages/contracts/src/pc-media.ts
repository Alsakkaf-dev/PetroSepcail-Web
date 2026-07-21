import { z } from "zod";

// 60-platform-core/05-api-specification.md §6 (Media, PC-09).

const mediaPurpose = z.enum(["product_image", "pod_photo", "invoice", "transfer_proof"]);

// EP-PC-050 · POST /media/upload-url · auth
export const uploadUrlRequest = z.object({
  purpose: mediaPurpose,
  contentType: z.string(),
  sizeBytes: z.number().int().positive()
});
export type UploadUrlRequest = z.infer<typeof uploadUrlRequest>;

export const uploadUrlResponse = z.object({
  uploadUrl: z.string(),
  objectKey: z.string(),
  expiresIn: z.number().int().positive()
});
export type UploadUrlResponse = z.infer<typeof uploadUrlResponse>;

// EP-PC-051 · GET /media/{objectKey}/url · auth
export const downloadUrlResponse = z.object({
  url: z.string(),
  expiresIn: z.number().int().positive()
});
export type DownloadUrlResponse = z.infer<typeof downloadUrlResponse>;
