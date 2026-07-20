import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const secretsDir = process.env.SECRETS_DIR ?? "./secrets";

export function generateJwtKeys() {
  const privatePath = path.join(secretsDir, "jwt_private.pem");
  const publicPath = path.join(secretsDir, "jwt_public.pem");

  if (existsSync(privatePath) && existsSync(publicPath)) {
    console.log("[init] JWT RS256 keypair already present — skipping");
    return;
  }

  mkdirSync(secretsDir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey, { mode: 0o644 });
  console.log("[init] Generated JWT RS256 keypair at", secretsDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateJwtKeys();
}
