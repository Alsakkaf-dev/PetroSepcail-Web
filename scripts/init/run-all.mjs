import { generateJwtKeys } from "./generate-jwt-keys.mjs";
import { generateMfaKey } from "./generate-mfa-key.mjs";
import { generateZatcaStampKey } from "./generate-zatca-key.mjs";
import { initMinioBuckets } from "./init-minio-buckets.mjs";
import { uploadCatalogMedia } from "./upload-catalog-media.mjs";

// Caddy's local TLS cert is NOT generated here — its automatic HTTPS issues
// one internally on first request (ADR-12), so there is nothing to script.
generateJwtKeys();
generateZatcaStampKey();
generateMfaKey();
await initMinioBuckets();
// SF-01 (S07): depends on 0023_catalog_seed.sql's core.media_objects rows
// existing, but only by object_key agreement, not run ordering — see that
// script's own header comment.
await uploadCatalogMedia();

console.log("[init] First-boot init complete");
