import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode } from "./base32.js";
import { buildOtpauthUri, generateTotpSecret, maskSecret, verifyTotp } from "./totp.js";

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const original = Buffer.from("12345678901234567890", "ascii");
    expect(base32Decode(base32Encode(original))).toEqual(original);
  });

  it("matches the RFC 4648 test vector", () => {
    expect(base32Encode(Buffer.from("foobar", "ascii"))).toBe("MZXW6YTBOI");
  });
});

describe("totp", () => {
  // RFC 4226 Appendix D HOTP test vectors: secret "12345678901234567890"
  // (ASCII, 20 bytes), 6-digit truncation, counters 0..9. TOTP is HOTP with
  // counter = floor(unixTime / 30), so driving totp with unixTime = counter*30
  // reproduces the exact RFC values — proves the HMAC/truncation logic is
  // correct, independent of any time-window concerns.
  const rfc4226Secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
  const vectors = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489"
  ];

  it.each(vectors.map((code, counter) => [counter, code] as const))(
    "counter %i produces RFC 4226 code %s",
    (counter, code) => {
      expect(verifyTotp(rfc4226Secret, code, counter * 30)).toBe(true);
    }
  );

  it("rejects a wrong code", () => {
    expect(verifyTotp(rfc4226Secret, "000000", 0)).toBe(false);
  });

  it("accepts one step of clock drift either side", () => {
    expect(verifyTotp(rfc4226Secret, vectors[1]!, 0)).toBe(true); // +1 step
    expect(verifyTotp(rfc4226Secret, vectors[0]!, 30)).toBe(true); // -1 step
  });

  it("rejects two steps of drift", () => {
    expect(verifyTotp(rfc4226Secret, vectors[2]!, 0)).toBe(false);
  });

  it("generates a valid otpauth URI carrying the secret", () => {
    const secret = generateTotpSecret();
    const uri = buildOtpauthUri(secret, "customer@example.com");
    expect(uri).toContain(`secret=${secret}`);
    expect(uri.startsWith("otpauth://totp/PetroSpecial")).toBe(true);
  });

  it("masks a secret leaving only the first/last 4 chars", () => {
    const masked = maskSecret("ABCDEFGHIJKLMNOP");
    expect(masked).toBe("ABCD********MNOP");
  });
});
