import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const secretsDir = process.env.SECRETS_DIR ?? "./secrets";

// AES-256-GCM key for encrypting core.mfa_secrets.totp_secret at rest
// (04-database-design §3.4 column comment: "encrypted (pgcrypto)" — pgcrypto
// is installed in the DB for future use, but the actual encrypt/decrypt runs
// in services/api using this key, which is simpler to test and keeps the key
// out of every SQL statement). Self-hosted, generated on first boot — no
// external KMS (D-12).
export function generateMfaKey() {
  const keyPath = path.join(secretsDir, "mfa_encryption.key");

  if (existsSync(keyPath)) {
    console.log("[init] MFA encryption key already present — skipping");
    return;
  }

  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(keyPath, randomBytes(32).toString("base64"), { mode: 0o600 });
  console.log("[init] Generated MFA encryption key at", secretsDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateMfaKey();
}
