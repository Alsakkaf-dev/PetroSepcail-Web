import { createHmac, randomBytes } from "node:crypto";
import { base32Decode, base32Encode } from "./base32.js";

// HOTP (RFC 4226) + TOTP (RFC 6238): 6-digit codes, SHA-1, 30s step — the
// universal defaults every authenticator app (Google/Microsoft/Authy) uses.
// FR-PC01-006: "a valid 6-digit code is required".
const DIGITS = 6;
const STEP_SECONDS = 30;

function hotp(secret: Buffer, counter: number): string {
  if (counter < 0) return ""; // never matches a real 6-digit code
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binCode % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

function totpAt(secretBase32: string, unixSeconds: number): string {
  const counter = Math.floor(unixSeconds / STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160-bit, RFC 4226 §4 recommended minimum
}

export function buildOtpauthUri(secretBase32: string, accountLabel: string, issuer = "PetroSpecial"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS)
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function maskSecret(secretBase32: string): string {
  return `${secretBase32.slice(0, 4)}${"*".repeat(Math.max(0, secretBase32.length - 8))}${secretBase32.slice(-4)}`;
}

// Accepts the current step and one step of clock drift each side (±30s),
// matching common authenticator-app tolerance.
export function verifyTotp(secretBase32: string, token: string, nowSeconds = Date.now() / 1000): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  for (const drift of [0, -1, 1]) {
    if (totpAt(secretBase32, nowSeconds + drift * STEP_SECONDS) === token) return true;
  }
  return false;
}
