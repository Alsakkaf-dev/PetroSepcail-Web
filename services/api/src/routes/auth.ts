import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  accountDeleteResponse,
  loginRequest,
  loginRoleSelectionResponse,
  loginSuccessResponse,
  mfaConfirmRequest,
  mfaConfirmResponse,
  mfaEnrollResponse,
  passwordResetConfirmRequest,
  passwordResetRequestRequest,
  refreshRequest,
  refreshResponse,
  registerRequest,
  registerResponse,
  verifyEmailRequest,
  verifyEmailResponse
} from "@petrospecial/contracts";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { publishEvent } from "../events/publishEvent.js";
import * as repo from "../repositories/authRepository.js";
import { requireAuth } from "../requireAuth.js";
import { buildOtpauthUri, generateTotpSecret, maskSecret, verifyTotp } from "../security/totp.js";
import { decryptTotpSecret, encryptTotpSecret } from "../security/mfaCrypto.js";
import { signAccessToken, type UserRole } from "../security/jwt.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { generateOpaqueToken, sha256Hex } from "../security/tokens.js";

// 04-roles-and-permissions-matrix §1: "5 failed attempts within 15 min ->
// locked 15 min" (FR-PC01-003 AC4). Not a [BUSINESS-CONFIRM] core.settings
// value in 04-database-design §3.9's seed list — treated as a fixed spec
// constant, not invented config.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const EMAIL_VERIFY_TTL_MINUTES = 60 * 24; // FR-PC01-001 AC1: 24h [BUSINESS-CONFIRM]
const PASSWORD_RESET_TTL_MINUTES = 30; // FR-PC01-007: 30 min

function accessTtlSeconds(): number {
  return Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 3600);
}
function refreshTtlSeconds(): number {
  return Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 2_592_000);
}

const ADMIN_ROLES: readonly UserRole[] = ["admin", "super_admin"];

export function registerAuthRoutes(app: FastifyInstance): void {
  // EP-PC-001 · POST /auth/register
  app.post("/api/v1/auth/register", async (request, reply) => {
    const body = registerRequest.parse(request.body);

    const result = await withServiceRoleTransaction(async (client) => {
      if (await repo.identityExists(client, body.email, body.phone)) {
        throw new ApiError("IDENTITY_EXISTS");
      }
      const passwordHash = await hashPassword(body.password);
      const identityId = await repo.createIdentity(client, {
        fullName: body.fullName,
        email: body.email,
        phone: body.phone,
        passwordHash,
        locale: body.locale ?? "ar"
      });
      await repo.createRoleGrant(client, identityId, "customer");

      const rawToken = generateOpaqueToken();
      await repo.createVerificationToken(client, {
        identityId,
        purpose: "email_verify",
        tokenHash: sha256Hex(rawToken),
        ttlMinutes: EMAIL_VERIFY_TTL_MINUTES
      });

      // EV-PC-001 identity.user.registered (06-integration-contracts §2),
      // same transaction as the state change (FR-PC05-001). Consumers per
      // the catalog: PC-06 (welcome notification, S05), LE-04 (S19) — this
      // session (S04) only builds the bus; those sessions register consumers.
      await publishEvent(client, {
        name: "identity.user.registered",
        actorSub: identityId,
        actorRole: "customer",
        payload: { user_id: identityId, role: "customer", locale: body.locale ?? "ar" }
      });

      return { identityId, rawToken };
    });

    // FR-PC01-001 AC3: link only ever returned in onscreen mode (delivery via
    // PC-06's real mailer is wired in S05 — see Handover Brief).
    const verifyLink =
      process.env.EMAIL_MODE === "onscreen"
        ? `${process.env.PUBLIC_BASE_URL ?? ""}/verify-email?token=${result.rawToken}`
        : undefined;

    return reply.code(201).send(
      registerResponse.parse({
        identityId: result.identityId,
        status: "pending_verification",
        ...(verifyLink ? { verifyLink } : {})
      })
    );
  });

  // EP-PC-002 · POST /auth/verify-email
  app.post("/api/v1/auth/verify-email", async (request, reply) => {
    const body = verifyEmailRequest.parse(request.body);
    await withServiceRoleTransaction(async (client) => {
      const token = await repo.findValidVerificationToken(client, sha256Hex(body.token), "email_verify");
      if (!token) throw new ApiError("TOKEN_INVALID");
      await repo.activateIdentity(client, token.identity_id);
      await repo.consumeVerificationToken(client, token.id);
    });
    return reply.code(200).send(verifyEmailResponse.parse({ status: "active" }));
  });

  // EP-PC-003 · POST /auth/login
  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = loginRequest.parse(request.body);

    const outcome = await withServiceRoleTransaction(async (client) => {
      const identity = await repo.findIdentityByEmail(client, body.email);
      if (!identity) throw new ApiError("INVALID_CREDENTIALS");

      if (identity.locked_until && identity.locked_until.getTime() > Date.now()) {
        throw new ApiError("ACCOUNT_LOCKED");
      }

      const passwordOk = await verifyPassword(identity.password_hash, body.password);
      if (!passwordOk) {
        const { locked } = await repo.recordFailedLogin(client, identity.id, LOCKOUT_THRESHOLD, LOCKOUT_MINUTES);
        throw new ApiError(locked ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS");
      }

      // Password proven correct before revealing any status beyond "wrong
      // credentials" (avoids leaking account state to an unauthenticated guesser).
      if (identity.status === "pending_verification") throw new ApiError("EMAIL_UNVERIFIED");
      if (identity.status !== "active") throw new ApiError("ACCOUNT_LOCKED");

      const grants = await repo.getRoleGrants(client, identity.id);
      if (grants.length === 0) throw new ApiError("INVALID_CREDENTIALS");

      let selected: repo.RoleGrantRow | undefined;
      if (body.role) {
        selected = grants.find((g) => g.role === body.role);
        if (!selected) throw new ApiError("FORBIDDEN", { reason: "role not held by this identity" });
      } else if (grants.length === 1) {
        selected = grants[0];
      } else {
        return { kind: "role_selection_required" as const, roles: grants.map((g) => g.role) };
      }

      // FR-PC01-006: MFA required for admin/super_admin *once enrolled*.
      // Bootstrapping note (SPEC-GAP — spec doesn't address the chicken-egg
      // problem): an admin with no confirmed MFA secret yet must still be
      // able to log in once, in order to reach EP-PC-008/009 and enroll.
      if (ADMIN_ROLES.includes(selected!.role)) {
        const mfa = await repo.getMfaSecret(client, identity.id);
        if (mfa?.confirmed_at) {
          if (!body.totp) throw new ApiError("MFA_REQUIRED");
          const secret = decryptTotpSecret(mfa.totp_secret);
          if (!verifyTotp(secret, body.totp)) throw new ApiError("MFA_INVALID");
        }
      }

      await repo.resetFailedLogins(client, identity.id);

      const familyId = randomUUID();
      const refreshTokenRaw = generateOpaqueToken();
      await repo.createAuthToken(client, {
        identityId: identity.id,
        familyId,
        tokenHash: sha256Hex(refreshTokenRaw),
        role: selected!.role,
        ttlSeconds: refreshTtlSeconds(),
        userAgent: request.headers["user-agent"],
        ip: request.ip
      });

      const accessToken = await signAccessToken(
        {
          sub: identity.id,
          role: selected!.role,
          supplier_id: selected!.supplier_id ?? undefined,
          driver_id: selected!.driver_id ?? undefined,
          locale: identity.locale
        },
        accessTtlSeconds()
      );

      return {
        kind: "success" as const,
        accessToken,
        refreshToken: refreshTokenRaw,
        expiresIn: accessTtlSeconds(),
        role: selected!.role
      };
    });

    if (outcome.kind === "role_selection_required") {
      return reply
        .code(200)
        .send(loginRoleSelectionResponse.parse({ status: "role_selection_required", roles: outcome.roles }));
    }
    return reply.code(200).send(
      loginSuccessResponse.parse({
        accessToken: outcome.accessToken,
        refreshToken: outcome.refreshToken,
        expiresIn: outcome.expiresIn,
        role: outcome.role
      })
    );
  });

  // EP-PC-004 · POST /auth/refresh
  app.post("/api/v1/auth/refresh", async (request, reply) => {
    const body = refreshRequest.parse(request.body);
    const tokenHash = sha256Hex(body.refreshToken);

    const result = await withServiceRoleTransaction(async (client) => {
      const existing = await repo.findAuthTokenByHash(client, tokenHash);
      if (!existing) throw new ApiError("TOKEN_INVALID");

      if (existing.revoked_at || existing.rotated_at) {
        // Reuse of an already-rotated/revoked refresh token: the whole
        // family is compromised — revoke it entirely (FR-PC01-004 AC2).
        await repo.revokeAuthTokenFamily(client, existing.family_id);
        throw new ApiError("TOKEN_REUSE_DETECTED");
      }
      if (existing.expires_at.getTime() <= Date.now()) throw new ApiError("TOKEN_INVALID");

      const identity = await repo.findIdentityById(client, existing.identity_id);
      if (!identity || identity.status !== "active") throw new ApiError("TOKEN_INVALID");
      const grants = await repo.getRoleGrants(client, identity.id);
      const grant = grants.find((g) => g.role === existing.role);
      if (!grant) throw new ApiError("TOKEN_INVALID");

      await repo.markAuthTokenRotated(client, existing.id);
      const refreshTokenRaw = generateOpaqueToken();
      // Sliding window: each successful rotation gets a fresh full TTL from
      // now, same family — standard "rotate on use" refresh-token UX.
      await repo.createAuthToken(client, {
        identityId: identity.id,
        familyId: existing.family_id,
        tokenHash: sha256Hex(refreshTokenRaw),
        role: existing.role,
        ttlSeconds: refreshTtlSeconds(),
        userAgent: request.headers["user-agent"],
        ip: request.ip
      });

      const accessToken = await signAccessToken(
        {
          sub: identity.id,
          role: existing.role,
          supplier_id: grant.supplier_id ?? undefined,
          driver_id: grant.driver_id ?? undefined,
          locale: identity.locale
        },
        accessTtlSeconds()
      );

      return { accessToken, refreshToken: refreshTokenRaw, expiresIn: accessTtlSeconds() };
    });

    return reply.code(200).send(refreshResponse.parse(result));
  });

  // EP-PC-005 · POST /auth/logout · auth
  // SPEC-GAP: the frozen JWT (04-roles §2) carries no family_id, so an
  // access-token-only request cannot identify "the current" refresh family.
  // Least-surprising reading: accept an optional refreshToken in the body to
  // revoke exactly that family; otherwise revoke every active family for
  // this identity+role (log out of this role everywhere).
  app.post("/api/v1/auth/logout", async (request, reply) => {
    const actor = await requireAuth(request);
    const body = (request.body ?? {}) as { refreshToken?: string };

    await withServiceRoleTransaction(async (client) => {
      if (body.refreshToken) {
        const token = await repo.findAuthTokenByHash(client, sha256Hex(body.refreshToken));
        if (token) await repo.revokeAuthTokenFamily(client, token.family_id);
      } else {
        const familyIds = await repo.findActiveFamilyIdsForIdentityRole(client, actor.sub, actor.role);
        for (const familyId of familyIds) await repo.revokeAuthTokenFamily(client, familyId);
      }
    });
    return reply.code(204).send();
  });

  // EP-PC-006 · POST /auth/password-reset/request
  app.post("/api/v1/auth/password-reset/request", async (request, reply) => {
    const body = passwordResetRequestRequest.parse(request.body);
    await withServiceRoleTransaction(async (client) => {
      const identity = await repo.findIdentityByEmail(client, body.email);
      // Always 202 regardless of outcome — no user enumeration (spec-explicit).
      if (!identity || identity.status === "deleted") return;
      const rawToken = generateOpaqueToken();
      await repo.createVerificationToken(client, {
        identityId: identity.id,
        purpose: "password_reset",
        tokenHash: sha256Hex(rawToken),
        ttlMinutes: PASSWORD_RESET_TTL_MINUTES
      });
      // Delivery via PC-06 lands in S05 (same as register's verify link) —
      // token is stored and reachable via service-role access until then.
    });
    return reply.code(202).send();
  });

  // EP-PC-007 · POST /auth/password-reset/confirm
  app.post("/api/v1/auth/password-reset/confirm", async (request, reply) => {
    const body = passwordResetConfirmRequest.parse(request.body);
    await withServiceRoleTransaction(async (client) => {
      const token = await repo.findValidVerificationToken(client, sha256Hex(body.token), "password_reset");
      if (!token) throw new ApiError("TOKEN_INVALID");
      const passwordHash = await hashPassword(body.newPassword);
      await repo.updatePasswordHash(client, token.identity_id, passwordHash);
      await repo.consumeVerificationToken(client, token.id);
      await repo.revokeAllAuthTokensForIdentity(client, token.identity_id); // FR-PC01-007
    });
    return reply.code(200).send();
  });

  // EP-PC-008 · POST /auth/mfa/enroll · auth (admin roles)
  app.post("/api/v1/auth/mfa/enroll", async (request, reply) => {
    const actor = await requireAuth(request);
    if (!ADMIN_ROLES.includes(actor.role)) throw new ApiError("FORBIDDEN");

    const secret = generateTotpSecret();
    await withServiceRoleTransaction(async (client) => {
      await repo.upsertPendingMfaSecret(client, actor.sub, encryptTotpSecret(secret));
    });

    const parsed = mfaEnrollResponse.parse({
      otpauthUri: buildOtpauthUri(secret, actor.sub),
      secretMasked: maskSecret(secret)
    });
    return reply.code(200).send(parsed);
  });

  // POST /auth/mfa/confirm (named EP-PC-009 inline in the EP-PC-008 spec entry)
  app.post("/api/v1/auth/mfa/confirm", async (request, reply) => {
    const actor = await requireAuth(request);
    const body = mfaConfirmRequest.parse(request.body);

    await withServiceRoleTransaction(async (client) => {
      const mfa = await repo.getMfaSecret(client, actor.sub);
      if (!mfa) throw new ApiError("VALIDATION_ERROR", { reason: "no MFA enrollment in progress" });
      const secret = decryptTotpSecret(mfa.totp_secret);
      if (!verifyTotp(secret, body.totp)) throw new ApiError("MFA_INVALID");
      await repo.confirmMfaSecret(client, actor.sub);
    });

    return reply.code(200).send(mfaConfirmResponse.parse({ enabled: true }));
  });

  // EP-PC-010 · POST /auth/account/delete · auth
  app.post("/api/v1/auth/account/delete", async (request, reply) => {
    const actor = await requireAuth(request);
    const purgeAfter = await withServiceRoleTransaction(async (client) => {
      await repo.markDeletionRequested(client, actor.sub);
      await repo.revokeAllAuthTokensForIdentity(client, actor.sub);
      const purge = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // FR-PC01-008: 30-day grace
      return purge.toISOString();
    });

    const parsed = accountDeleteResponse.parse({ status: "pending_deletion", purgeAfter });
    return reply.code(202).send(parsed);
  });
}
