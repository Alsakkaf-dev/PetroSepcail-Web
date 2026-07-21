import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashes as argon2id and verifies the correct password", async () => {
    const hash = await hashPassword("Correct-Horse-Battery-Staple-1");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "Correct-Horse-Battery-Staple-1")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("Correct-Horse-Battery-Staple-1");
    expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  });

  it("never matches a malformed/placeholder hash instead of crashing", async () => {
    expect(await verifyPassword("$argon2id$SEED-PLACEHOLDER$not-a-real-hash", "anything")).toBe(false);
  });
});
