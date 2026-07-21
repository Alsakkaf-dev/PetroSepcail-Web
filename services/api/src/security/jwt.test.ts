import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "./jwt.js";

// Self-contained: generates its own throwaway RS256 keypair rather than
// depending on secrets/jwt_*.pem (same reasoning as mfaCrypto.test.ts).
describe("jwt", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ps-jwt-key-"));
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048, // smaller than the real 4096 — faster tests, same code path
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const privatePath = path.join(dir, "jwt_private.pem");
    const publicPath = path.join(dir, "jwt_public.pem");
    writeFileSync(privatePath, privateKey);
    writeFileSync(publicPath, publicKey);
    process.env.JWT_PRIVATE_KEY_PATH = privatePath;
    process.env.JWT_PUBLIC_KEY_PATH = publicPath;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips the frozen claim shape (04-roles §2)", async () => {
    const token = await signAccessToken(
      { sub: "00000000-0000-0000-0000-000000000001", role: "customer", locale: "ar" },
      3600
    );
    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe("00000000-0000-0000-0000-000000000001");
    expect(claims.role).toBe("customer");
    expect(claims.locale).toBe("ar");
    expect(claims.supplier_id).toBeUndefined();
    expect(claims.driver_id).toBeUndefined();
    expect(typeof claims.exp).toBe("number");
  });

  it("carries supplier_id for a supplier-role token", async () => {
    const token = await signAccessToken(
      {
        sub: "00000000-0000-0000-0000-000000000002",
        role: "supplier",
        supplier_id: "11111111-1111-1111-1111-111111111111",
        locale: "en"
      },
      3600
    );
    const claims = await verifyAccessToken(token);
    expect(claims.supplier_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects an expired token", async () => {
    const token = await signAccessToken(
      { sub: "00000000-0000-0000-0000-000000000001", role: "customer", locale: "ar" },
      -10 // already expired
    );
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });

  it("rejects a token with a tampered signature", async () => {
    const token = await signAccessToken(
      { sub: "00000000-0000-0000-0000-000000000001", role: "customer", locale: "ar" },
      3600
    );
    const [header, payload, signature] = token.split(".");
    const tamperedSig = signature!.slice(0, -4) + (signature!.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(verifyAccessToken(`${header}.${payload}.${tamperedSig}`)).rejects.toThrow();
  });

  it("rejects a token with a tampered payload", async () => {
    const token = await signAccessToken(
      { sub: "00000000-0000-0000-0000-000000000001", role: "customer", locale: "ar" },
      3600
    );
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: "00000000-0000-0000-0000-000000000099", role: "super_admin", locale: "ar" })
    ).toString("base64url");
    await expect(verifyAccessToken(`${header}.${forgedPayload}.${signature}`)).rejects.toThrow();
  });
});
