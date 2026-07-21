import type { PoolClient } from "pg";
import type { UserRole } from "../security/jwt.js";

// core.identities / core.role_grants / core.auth_tokens / core.mfa_secrets /
// core.verification_tokens (db/migrations/0004, S01). All queries here run
// inside a service_role transaction (services/api/src/db.ts) — parameterized
// throughout, never string-interpolated.

export interface IdentityRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  password_hash: string;
  status: "pending_verification" | "active" | "locked" | "pending_deletion" | "deleted";
  locale: "ar" | "en";
  failed_logins: number;
  locked_until: Date | null;
}

export async function findIdentityByEmail(client: PoolClient, email: string): Promise<IdentityRow | undefined> {
  const res = await client.query<IdentityRow>(
    `select id, full_name, email, phone, password_hash, status, locale, failed_logins, locked_until
     from core.identities where email = $1`,
    [email]
  );
  return res.rows[0];
}

export async function findIdentityById(client: PoolClient, id: string): Promise<IdentityRow | undefined> {
  const res = await client.query<IdentityRow>(
    `select id, full_name, email, phone, password_hash, status, locale, failed_logins, locked_until
     from core.identities where id = $1`,
    [id]
  );
  return res.rows[0];
}

export async function identityExists(client: PoolClient, email: string, phone: string): Promise<boolean> {
  const res = await client.query("select 1 from core.identities where email = $1 or phone = $2", [email, phone]);
  return res.rowCount! > 0;
}

export async function createIdentity(
  client: PoolClient,
  input: { fullName: string; email: string; phone: string; passwordHash: string; locale: "ar" | "en" }
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `insert into core.identities (full_name, email, phone, password_hash, locale)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.fullName, input.email, input.phone, input.passwordHash, input.locale]
  );
  return res.rows[0]!.id;
}

export async function activateIdentity(client: PoolClient, identityId: string): Promise<void> {
  await client.query("update core.identities set status = 'active' where id = $1", [identityId]);
}

export async function updatePasswordHash(client: PoolClient, identityId: string, passwordHash: string): Promise<void> {
  await client.query("update core.identities set password_hash = $2 where id = $1", [identityId, passwordHash]);
}

export async function recordFailedLogin(
  client: PoolClient,
  identityId: string,
  lockThreshold: number,
  lockMinutes: number
): Promise<{ failedLogins: number; locked: boolean }> {
  const res = await client.query<{ failed_logins: number }>(
    `update core.identities set failed_logins = failed_logins + 1 where id = $1 returning failed_logins`,
    [identityId]
  );
  const failedLogins = res.rows[0]!.failed_logins;
  if (failedLogins >= lockThreshold) {
    await client.query(`update core.identities set locked_until = now() + ($2 || ' minutes')::interval where id = $1`, [
      identityId,
      lockMinutes
    ]);
    return { failedLogins, locked: true };
  }
  return { failedLogins, locked: false };
}

export async function resetFailedLogins(client: PoolClient, identityId: string): Promise<void> {
  await client.query("update core.identities set failed_logins = 0, locked_until = null where id = $1", [identityId]);
}

export async function markDeletionRequested(client: PoolClient, identityId: string): Promise<void> {
  await client.query(
    "update core.identities set status = 'pending_deletion', deletion_requested_at = now() where id = $1",
    [identityId]
  );
}

// -- role_grants --------------------------------------------------------------

export interface RoleGrantRow {
  role: UserRole;
  supplier_id: string | null;
  driver_id: string | null;
}

export async function getRoleGrants(client: PoolClient, identityId: string): Promise<RoleGrantRow[]> {
  const res = await client.query<RoleGrantRow>(
    "select role, supplier_id, driver_id from core.role_grants where identity_id = $1",
    [identityId]
  );
  return res.rows;
}

export async function createRoleGrant(client: PoolClient, identityId: string, role: UserRole): Promise<void> {
  await client.query("insert into core.role_grants (identity_id, role) values ($1, $2)", [identityId, role]);
}

// -- verification_tokens (email_verify / password_reset) ---------------------

export interface VerificationTokenRow {
  id: string;
  identity_id: string;
  purpose: "email_verify" | "password_reset";
  expires_at: Date;
  consumed_at: Date | null;
}

export async function createVerificationToken(
  client: PoolClient,
  input: { identityId: string; purpose: "email_verify" | "password_reset"; tokenHash: string; ttlMinutes: number }
): Promise<void> {
  await client.query(
    `insert into core.verification_tokens (identity_id, purpose, token_hash, expires_at)
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [input.identityId, input.purpose, input.tokenHash, input.ttlMinutes]
  );
}

export async function findValidVerificationToken(
  client: PoolClient,
  tokenHash: string,
  purpose: "email_verify" | "password_reset"
): Promise<VerificationTokenRow | undefined> {
  const res = await client.query<VerificationTokenRow>(
    `select id, identity_id, purpose, expires_at, consumed_at from core.verification_tokens
     where token_hash = $1 and purpose = $2 and consumed_at is null and expires_at > now()`,
    [tokenHash, purpose]
  );
  return res.rows[0];
}

export async function consumeVerificationToken(client: PoolClient, id: string): Promise<void> {
  await client.query("update core.verification_tokens set consumed_at = now() where id = $1", [id]);
}

export async function revokeAllVerificationTokens(
  client: PoolClient,
  identityId: string,
  purpose: "email_verify" | "password_reset"
): Promise<void> {
  await client.query(
    "update core.verification_tokens set consumed_at = now() where identity_id = $1 and purpose = $2 and consumed_at is null",
    [identityId, purpose]
  );
}

// -- auth_tokens (refresh sessions) -------------------------------------------

export interface AuthTokenRow {
  id: string;
  identity_id: string;
  family_id: string;
  role: UserRole;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
}

export async function createAuthToken(
  client: PoolClient,
  input: {
    identityId: string;
    familyId: string;
    tokenHash: string;
    role: UserRole;
    ttlSeconds: number;
    userAgent?: string;
    ip?: string;
  }
): Promise<void> {
  await client.query(
    `insert into core.auth_tokens (identity_id, family_id, token_hash, role, expires_at, user_agent, ip)
     values ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval, $6, $7)`,
    [input.identityId, input.familyId, input.tokenHash, input.role, input.ttlSeconds, input.userAgent ?? null, input.ip ?? null]
  );
}

export async function findAuthTokenByHash(client: PoolClient, tokenHash: string): Promise<AuthTokenRow | undefined> {
  const res = await client.query<AuthTokenRow>(
    `select id, identity_id, family_id, role, expires_at, rotated_at, revoked_at
     from core.auth_tokens where token_hash = $1`,
    [tokenHash]
  );
  return res.rows[0];
}

export async function markAuthTokenRotated(client: PoolClient, id: string): Promise<void> {
  await client.query("update core.auth_tokens set rotated_at = now() where id = $1", [id]);
}

export async function revokeAuthTokenFamily(client: PoolClient, familyId: string): Promise<void> {
  await client.query(
    "update core.auth_tokens set revoked_at = now() where family_id = $1 and revoked_at is null",
    [familyId]
  );
}

// FR-PC01-007: "on reset, all sessions of that identity are revoked."
export async function revokeAllAuthTokensForIdentity(client: PoolClient, identityId: string): Promise<void> {
  await client.query(
    "update core.auth_tokens set revoked_at = now() where identity_id = $1 and revoked_at is null",
    [identityId]
  );
}

export async function findActiveFamilyIdsForIdentityRole(
  client: PoolClient,
  identityId: string,
  role: UserRole
): Promise<string[]> {
  const res = await client.query<{ family_id: string }>(
    `select distinct family_id from core.auth_tokens
     where identity_id = $1 and role = $2 and revoked_at is null and expires_at > now()`,
    [identityId, role]
  );
  return res.rows.map((r) => r.family_id);
}

// -- mfa_secrets ---------------------------------------------------------------

export interface MfaSecretRow {
  totp_secret: string; // ciphertext (mfaCrypto.ts)
  confirmed_at: Date | null;
}

export async function getMfaSecret(client: PoolClient, identityId: string): Promise<MfaSecretRow | undefined> {
  const res = await client.query<MfaSecretRow>(
    "select totp_secret, confirmed_at from core.mfa_secrets where identity_id = $1",
    [identityId]
  );
  return res.rows[0];
}

export async function upsertPendingMfaSecret(client: PoolClient, identityId: string, encryptedSecret: string): Promise<void> {
  await client.query(
    `insert into core.mfa_secrets (identity_id, totp_secret, confirmed_at)
     values ($1, $2, null)
     on conflict (identity_id) do update set totp_secret = excluded.totp_secret, confirmed_at = null`,
    [identityId, encryptedSecret]
  );
}

export async function confirmMfaSecret(client: PoolClient, identityId: string): Promise<void> {
  await client.query("update core.mfa_secrets set confirmed_at = now() where identity_id = $1", [identityId]);
}
