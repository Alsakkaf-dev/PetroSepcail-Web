import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8, importSPKI, jwtVerify, type JWTPayload, type KeyLike } from "jose";

// Frozen JWT claim shape (04-roles-and-permissions-matrix §2): snake_case,
// exactly {sub, role, supplier_id?, driver_id?, locale, exp} — this is what
// every RLS policy reads via auth.jwt() (db/migrations/0001, S01), so the key
// names here are NOT the usual camelCase JSON convention (D-08 only governs
// REST bodies, not this frozen claim contract).
//
// Shared between services/api and services/realtime (S04): the Caddyfile
// proxies `/realtime*` straight to the realtime container, bypassing the api
// gateway entirely, so realtime must verify JWTs independently rather than
// trusting an already-resolved actor — same verification logic, not
// duplicated code.
export type UserRole = "customer" | "supplier" | "driver" | "admin" | "super_admin";

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  role: UserRole;
  supplier_id?: string;
  driver_id?: string;
  locale: "ar" | "en";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

// Two supported deployment models: local/test (secrets/init scripts write
// real PEM files to disk, *_PATH points at them) and Vercel serverless
// (D-15 pivot — no persistent/shared filesystem to write a secrets volume
// into, so the PEM content itself is a Vercel encrypted Environment
// Variable). Content wins when both are set; a literal "\n" is unescaped
// since pasting a multi-line PEM into a single-line env var UI commonly
// requires that.
function loadKeyMaterial(contentVar: string, pathVar: string): string {
  const content = process.env[contentVar];
  if (content) return content.includes("\\n") ? content.replace(/\\n/g, "\n") : content;
  return readFileSync(requireEnv(pathVar), "utf8");
}

let privateKeyPromise: Promise<KeyLike> | undefined;
let publicKeyPromise: Promise<KeyLike> | undefined;

function getPrivateKey(): Promise<KeyLike> {
  privateKeyPromise ??= importPKCS8(loadKeyMaterial("JWT_PRIVATE_KEY", "JWT_PRIVATE_KEY_PATH"), "RS256");
  return privateKeyPromise;
}

function getPublicKey(): Promise<KeyLike> {
  publicKeyPromise ??= importSPKI(loadKeyMaterial("JWT_PUBLIC_KEY", "JWT_PUBLIC_KEY_PATH"), "RS256");
  return publicKeyPromise;
}

export async function signAccessToken(
  claims: Pick<AccessTokenClaims, "sub" | "role" | "supplier_id" | "driver_id" | "locale">,
  ttlSeconds: number
): Promise<string> {
  const key = await getPrivateKey();
  // No .setIssuedAt(): 04-roles §2/FR-PC02-001 AC1 requires the JWT to carry
  // *exactly* {sub, role, supplier_id?, driver_id?, locale, exp} — jose's
  // setIssuedAt() would add an extra `iat` claim beyond that frozen shape.
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "RS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(token, key, { algorithms: ["RS256"] });
  return payload as AccessTokenClaims;
}
