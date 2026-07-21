import { hash, verify } from "@node-rs/argon2";

// NFR-PC-002: "Passwords argon2id (memory >= 64 MB, iterations tuned to >= 250 ms)".
// memoryCost=65536 KiB (64 MiB), timeCost=8 was empirically measured at ~252ms on
// dev hardware — tune again if production hardware timing drifts (S21 hardening).
// algorithm: 2 = Argon2id (the package's `Algorithm` is an ambient const enum,
// which `isolatedModules` (tsconfig.base.json) cannot import across files).
const ARGON2ID_OPTIONS = {
  algorithm: 2,
  memoryCost: 65536,
  timeCost: 8,
  parallelism: 1
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2ID_OPTIONS);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain, ARGON2ID_OPTIONS);
  } catch {
    // Malformed/placeholder hash (e.g. seed rows) — never a match, never a crash.
    return false;
  }
}
