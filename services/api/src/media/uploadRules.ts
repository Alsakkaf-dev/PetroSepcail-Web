import type { MediaPurpose } from "./minioClient.js";

// FR-PC09-003: "Server validates type/size (POD & proof images ≤ 5 MB
// jpeg/webp/png; product images per AC-02 rules)". AC-02 (product image
// rules) isn't built until S07 — its Read scope owns those specifics — so
// `product_image` uses the same conservative default as the explicitly-
// specified purposes here; S07 may tighten it. `invoice` isn't detailed
// anywhere in this session's Read scope either (SP-04/S15 owns ZATCA XML/PDF
// specifics) — a reasonable provisional default. All four are SPEC-GAP
// where not verbatim from FR-PC09-003.
interface UploadRule {
  allowedContentTypes: readonly string[];
  maxSizeBytes: number;
}

const RULES: Record<MediaPurpose, UploadRule> = {
  pod_photo: { allowedContentTypes: ["image/jpeg", "image/webp", "image/png"], maxSizeBytes: 5 * 1024 * 1024 },
  transfer_proof: { allowedContentTypes: ["image/jpeg", "image/webp", "image/png"], maxSizeBytes: 5 * 1024 * 1024 },
  product_image: { allowedContentTypes: ["image/jpeg", "image/webp", "image/png"], maxSizeBytes: 5 * 1024 * 1024 },
  invoice: { allowedContentTypes: ["application/pdf", "application/xml"], maxSizeBytes: 10 * 1024 * 1024 }
};

export interface UploadValidationError {
  field: "contentType" | "sizeBytes";
  reason: string;
}

export function validateUpload(purpose: MediaPurpose, contentType: string, sizeBytes: number): UploadValidationError | null {
  const rule = RULES[purpose];
  if (!rule.allowedContentTypes.includes(contentType)) {
    return { field: "contentType", reason: `must be one of: ${rule.allowedContentTypes.join(", ")}` };
  }
  if (sizeBytes > rule.maxSizeBytes) {
    return { field: "sizeBytes", reason: `must be <= ${rule.maxSizeBytes} bytes` };
  }
  if (sizeBytes <= 0) {
    return { field: "sizeBytes", reason: "must be positive" };
  }
  return null;
}
