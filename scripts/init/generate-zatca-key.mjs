import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const secretsDir = process.env.SECRETS_DIR ?? "./secrets";

// P-256 keypair for the local crypto-stamp; S15 (ADR-11) finalizes the exact
// curve/format ZATCA's real clearance API expects when the adapter swaps.
export function generateZatcaStampKey() {
  const privatePath = path.join(secretsDir, "zatca_stamp_key.pem");
  const publicPath = path.join(secretsDir, "zatca_stamp_key.pub.pem");

  if (existsSync(privatePath) && existsSync(publicPath)) {
    console.log("[init] ZATCA-sim stamp key already present — skipping");
    return;
  }

  mkdirSync(secretsDir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey, { mode: 0o644 });
  console.log("[init] Generated ZATCA-sim stamp key at", secretsDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateZatcaStampKey();
}
