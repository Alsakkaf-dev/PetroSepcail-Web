import { generateJwtKeys } from "./generate-jwt-keys.mjs";
import { generateMfaKey } from "./generate-mfa-key.mjs";
import { generateZatcaStampKey } from "./generate-zatca-key.mjs";
import { initMinioBuckets } from "./init-minio-buckets.mjs";

// Caddy's local TLS cert is NOT generated here — its automatic HTTPS issues
// one internally on first request (ADR-12), so there is nothing to script.
generateJwtKeys();
generateZatcaStampKey();
generateMfaKey();
await initMinioBuckets();

console.log("[init] First-boot init complete");
