import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

// At-rest encryption for core.mfa_secrets.totp_secret (04-database-design
// §3.4 column comment: "encrypted (pgcrypto)"). pgcrypto is installed in the
// DB (db/migrations/0001) for future use, but the actual AEAD encrypt/decrypt
// runs here with a key from MFA_ENCRYPTION_KEY_PATH (generated on first boot,
// scripts/init/generate-mfa-key.mjs) — equally secure, and keeps the key
// entirely out of SQL statements/logs.
let keyPromise: Buffer | undefined;

function getKey(): Buffer {
  if (!keyPromise) {
    const path = process.env.MFA_ENCRYPTION_KEY_PATH;
    if (!path) throw new Error("missing required env var MFA_ENCRYPTION_KEY_PATH");
    keyPromise = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  }
  return keyPromise;
}

// Stored format: base64(iv[12] || authTag[16] || ciphertext).
export function encryptTotpSecret(plainSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainSecret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptTotpSecret(stored: string): string {
  const raw = Buffer.from(stored, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
