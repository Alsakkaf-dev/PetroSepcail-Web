import { provisionUserRequest, provisionUserResponse, roleGrantRequest, roleGrantResponse, userStatusUpdateRequest, userStatusUpdateResponse } from "@petrospecial/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { publishEvent } from "../events/publishEvent.js";
import { requirePermission } from "../gateway/requirePermission.js";
import * as repo from "../repositories/authRepository.js";
import { generateOpaqueToken, sha256Hex } from "../security/tokens.js";
import { hashPassword } from "../security/password.js";
import type { AccessTokenClaims, UserRole } from "../security/jwt.js";

const ACTIVATION_TTL_MINUTES = 60 * 72; // FR-AC06-001 [BUSINESS-CONFIRM]: 72h

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

// FR-AC06-001: "Admin creates suppliers (offline-vetted, activation link) and
// drivers ... Self-registration is customer-only." The admin's own act of
// creating the account IS the vetting, so identities provisioned here are
// activated immediately (unlike /auth/register's pending_verification +
// email-confirm loop, which exists for self-registered customers) — the
// activation link only carries a password_reset-purpose token, reusing the
// exact EP-PC-007 confirm flow already built in S02 for the invitee to set
// their first real password.
async function provisionUser(
  actor: AccessTokenClaims,
  role: UserRole,
  body: { fullName: string; email: string; phone: string; locale: "ar" | "en" }
): Promise<{ identityId: string; activationLink?: string }> {
  return withServiceRoleTransaction(async (client) => {
    if (await repo.identityExists(client, body.email, body.phone)) {
      throw new ApiError("IDENTITY_EXISTS");
    }
    const unusablePasswordHash = await hashPassword(generateOpaqueToken());
    const identityId = await repo.createIdentity(client, {
      fullName: body.fullName,
      email: body.email,
      phone: body.phone,
      passwordHash: unusablePasswordHash,
      locale: body.locale
    });
    await repo.activateIdentity(client, identityId);
    await repo.createRoleGrant(client, identityId, role);

    const rawToken = generateOpaqueToken();
    await repo.createVerificationToken(client, {
      identityId,
      purpose: "password_reset",
      tokenHash: sha256Hex(rawToken),
      ttlMinutes: ACTIVATION_TTL_MINUTES
    });

    await publishEvent(client, {
      name: "identity.role.granted", // EV-PC-002
      actorSub: actor.sub,
      actorRole: actor.role,
      payload: { user_id: identityId, role, granted_by: actor.sub }
    });
    await client.query(
      `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
       values ($1, $2, 'user.provisioned', 'core.identities', $3, $4)`,
      [actor.sub, actor.role, identityId, JSON.stringify({ role, email: body.email })]
    );

    const activationLink = `${process.env.PUBLIC_BASE_URL ?? ""}/reset-password?token=${rawToken}`;
    return { identityId, ...(process.env.EMAIL_MODE === "onscreen" ? { activationLink } : {}) };
  });
}

export function registerAdminUserRoutes(app: FastifyInstance): void {
  // EP-AC-050 · POST /admin/users/suppliers · auth(admin)
  app.post(
    "/api/v1/admin/users/suppliers",
    { preHandler: requirePermission("create", "supplier_master") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = provisionUserRequest.parse(request.body);
      const result = await provisionUser(actor, "supplier", body);
      return reply
        .code(201)
        .send(provisionUserResponse.parse({ role: "supplier", status: "active", ...result }));
    }
  );

  // EP-AC-051 · POST /admin/users/drivers · auth(admin)
  app.post(
    "/api/v1/admin/users/drivers",
    { preHandler: requirePermission("create", "driver_profile") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = provisionUserRequest.parse(request.body);
      const result = await provisionUser(actor, "driver", body);
      return reply
        .code(201)
        .send(provisionUserResponse.parse({ role: "driver", status: "active", ...result }));
    }
  );

  // EP-AC-052 · POST /admin/users/admins · auth(super_admin) — FR-AC06-002:
  // "admin creating an admin is refused" is enforced structurally by this
  // preHandler (admin_account: super_admin-only "create" in authz.ts's
  // MATRIX), not by a business-rule check inside the handler.
  app.post(
    "/api/v1/admin/users/admins",
    { preHandler: requirePermission("create", "admin_account") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = provisionUserRequest.parse(request.body);
      const result = await provisionUser(actor, "admin", body);
      return reply
        .code(201)
        .send(provisionUserResponse.parse({ role: "admin", status: "active", ...result }));
    }
  );

  // EP-AC-053 · POST /admin/users/{id}/grants · auth(super_admin) — FR-AC06-002
  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/users/:id/grants",
    { preHandler: requirePermission("update", "admin_account") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = roleGrantRequest.parse(request.body);

      const roles = await withServiceRoleTransaction(async (client) => {
        const existing = await client.query("select 1 from core.identities where id = $1", [request.params.id]);
        if (existing.rowCount === 0) throw new ApiError("NOT_FOUND");

        if (body.action === "grant") {
          await client.query(
            "insert into core.role_grants (identity_id, role) values ($1, $2) on conflict do nothing",
            [request.params.id, body.role]
          );
        } else {
          await client.query("delete from core.role_grants where identity_id = $1 and role = $2", [
            request.params.id,
            body.role
          ]);
        }

        await publishEvent(client, {
          name: "identity.role.granted", // EV-PC-002 (covers both grant and revoke — payload.action distinguishes)
          actorSub: actor.sub,
          actorRole: actor.role,
          payload: { user_id: request.params.id, role: body.role, granted_by: actor.sub, action: body.action }
        });
        await client.query(
          `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
           values ($1, $2, $3, 'core.role_grants', $4, $5)`,
          [actor.sub, actor.role, `role.${body.action}`, request.params.id, JSON.stringify({ role: body.role })]
        );

        const res = await client.query<{ role: string }>("select role from core.role_grants where identity_id = $1", [
          request.params.id
        ]);
        return res.rows.map((r) => r.role);
      });

      return reply.code(200).send(roleGrantResponse.parse({ identityId: request.params.id, roles }));
    }
  );

  // EP-AC-054 · POST /admin/users/{id}/status · auth(admin) — FR-AC06-003.
  // Spans both supplier_master and driver_profile resources (a single
  // suspend/reactivate action, by id, regardless of which role the target
  // holds) — both grant admin the same "update" permission in authz.ts's
  // MATRIX, so a direct role check here (rather than requirePermission
  // against one specific resource) is the honest gate for a cross-resource action.
  app.post<{ Params: { id: string } }>("/api/v1/admin/users/:id/status", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const actor = requireActor(request);
    if (actor.role !== "admin" && actor.role !== "super_admin") throw new ApiError("FORBIDDEN");
    const body = userStatusUpdateRequest.parse(request.body);

    await withServiceRoleTransaction(async (client) => {
      const before = await client.query<{ status: string }>("select status from core.identities where id = $1", [
        request.params.id
      ]);
      if (before.rowCount === 0) throw new ApiError("NOT_FOUND");

      await client.query("update core.identities set status = $2 where id = $1", [request.params.id, body.status]);
      if (body.status === "suspended") {
        await repo.revokeAllAuthTokensForIdentity(client, request.params.id);
      }
      await client.query(
        `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, reason, before, after)
         values ($1, $2, 'user.status_changed', 'core.identities', $3, $4, $5, $6)`,
        [
          actor.sub,
          actor.role,
          request.params.id,
          body.reason,
          JSON.stringify({ status: before.rows[0]!.status }),
          JSON.stringify({ status: body.status })
        ]
      );
    });

    return reply.code(200).send(userStatusUpdateResponse.parse({ identityId: request.params.id, status: body.status }));
  });
}
