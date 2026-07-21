import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8, importSPKI, jwtVerify, type JWTPayload, type KeyLike } from "jose";

// Frozen JWT claim shape (04-roles-and-permissions-matrix §2): snake_case,
// exactly {sub, role, supplier_id?, driver_id?, locale, exp} — this is what
// every RLS policy reads via auth.jwt() (db/migrations/0001, S01), so the key
// names here are NOT the usual camelCase JSON convention (D-08 only governs
// REST bodies, not this frozen claim contract).
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

let privateKeyPromise: Promise<KeyLike> | undefined;
let publicKeyPromise: Promise<KeyLike> | undefined;

function getPrivateKey(): Promise<KeyLike> {
  privateKeyPromise ??= importPKCS8(readFileSync(requireEnv("JWT_PRIVATE_KEY_PATH"), "utf8"), "RS256");
  return privateKeyPromise;
}

function getPublicKey(): Promise<KeyLike> {
  publicKeyPromise ??= importSPKI(readFileSync(requireEnv("JWT_PUBLIC_KEY_PATH"), "utf8"), "RS256");
  return publicKeyPromise;
}

export async function signAccessToken(
  claims: Pick<AccessTokenClaims, "sub" | "role" | "supplier_id" | "driver_id" | "locale">,
  ttlSeconds: number
): Promise<string> {
  const key = await getPrivateKey();
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const key = await getPublicKey();
  const { payload } = await jwtVerify(token, key, { algorithms: ["RS256"] });
  return payload as AccessTokenClaims;
}
