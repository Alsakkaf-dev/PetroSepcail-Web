import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptTotpSecret, encryptTotpSecret } from "./mfaCrypto.js";

// Self-contained: writes its own throwaway key file rather than depending on
// secrets/mfa_encryption.key or .env being loaded (neither is guaranteed when
// `vitest run` executes outside Docker, e.g. the pre-commit hook / a fresh
// clone before `docker compose up` has ever run init).
describe("mfaCrypto", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ps-mfa-key-"));
    const keyPath = path.join(dir, "mfa_encryption.key");
    writeFileSync(keyPath, randomBytes(32).toString("base64"));
    process.env.MFA_ENCRYPTION_KEY_PATH = keyPath;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a TOTP secret through AES-256-GCM", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptTotpSecret(secret);
    expect(encrypted).not.toBe(secret);
    expect(decryptTotpSecret(encrypted)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptTotpSecret("same-secret");
    const b = encryptTotpSecret("same-secret");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered ciphertext (auth tag mismatch)", () => {
    const encrypted = encryptTotpSecret("tamper-test");
    const raw = Buffer.from(encrypted, "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    expect(() => decryptTotpSecret(raw.toString("base64"))).toThrow();
  });

  it("random bytes never accidentally decrypt", () => {
    expect(() => decryptTotpSecret(randomBytes(40).toString("base64"))).toThrow();
  });
});
