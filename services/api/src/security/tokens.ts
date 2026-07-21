import { createHash, randomBytes } from "node:crypto";

// Opaque, high-entropy tokens for refresh tokens (core.auth_tokens) and
// single-use verification tokens (core.verification_tokens) — never JWTs,
// per 04-database-design §3.3/§3.4 ("token_hash text not null, -- sha256 of
// refresh token"). Only the sha256 hash is ever persisted; the raw value is
// returned to the caller once and never stored.
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
