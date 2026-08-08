import { meResponse, meUpdateRequest } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withRlsTransaction, withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";

interface IdentityRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  locale: "ar" | "en";
}

// core.mfa_secrets carries no app_user RLS policy at all (0006 — deliberately
// service-role-only, same treatment as auth_tokens), so a plain RLS
// transaction sees zero rows regardless of ownership. This is the one place
// /me needs the service role: a scoped existence check, not a data read.
async function getMfaEnabled(identityId: string): Promise<boolean> {
  return withServiceRoleTransaction(async (client) => {
    const res = await client.query<{ confirmed_at: Date | null }>(
      "select confirmed_at from core.mfa_secrets where identity_id = $1",
      [identityId]
    );
    return res.rows[0]?.confirmed_at != null;
  });
}

// EP-PC-011 · GET /me · auth -> "own identity via RLS". The first real
// business endpoint on the PC-GW-3 path (S03): app_user + `set local
// request.jwt.claims`, not app_service_role — core.identities' identity_self_rw
// and core.role_grants' role_grants_self_read policies (db/migrations/0006,
// S01) do the actual scoping. Deliberately minimal (no WHERE-clause safety
// net beyond normal query shape) so the E2E test genuinely exercises RLS
// through the API path rather than just app-level filtering.
export function registerMeRoutes(app: FastifyInstance): void {
  app.get("/api/v1/me", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");

    const result = await withRlsTransaction(actor, async (client) => {
      const identity = await client.query<IdentityRow>(
        "select id, full_name, email, phone, locale from core.identities where id = $1",
        [actor.sub]
      );
      const grants = await client.query<{ role: string }>(
        "select role from core.role_grants where identity_id = $1",
        [actor.sub]
      );
      return { identity: identity.rows[0], roles: grants.rows.map((r) => r.role) };
    });

    if (!result.identity) throw new ApiError("NOT_FOUND");

    return reply.code(200).send(
      meResponse.parse({
        id: result.identity.id,
        fullName: result.identity.full_name,
        email: result.identity.email,
        phone: result.identity.phone,
        locale: result.identity.locale,
        roles: result.roles,
        mfaEnabled: await getMfaEnabled(result.identity.id)
      })
    );
  });

  // EP-PC-012 · PATCH /me · auth (S09) — FR-SF10-001 profile edit.
  app.patch("/api/v1/me", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");
    const body = meUpdateRequest.parse(request.body);

    const result = await withRlsTransaction(actor, async (client) => {
      const updated = await client.query<IdentityRow>(
        `update core.identities set
           full_name = coalesce($2, full_name),
           phone = coalesce($3, phone),
           locale = coalesce($4, locale)
         where id = $1
         returning id, full_name, email, phone, locale`,
        [actor.sub, body.fullName ?? null, body.phone ?? null, body.locale ?? null]
      );
      const grants = await client.query<{ role: string }>(
        "select role from core.role_grants where identity_id = $1",
        [actor.sub]
      );
      return { identity: updated.rows[0], roles: grants.rows.map((r) => r.role) };
    });

    if (!result.identity) throw new ApiError("NOT_FOUND");
    return reply.code(200).send(
      meResponse.parse({
        id: result.identity.id,
        fullName: result.identity.full_name,
        email: result.identity.email,
        phone: result.identity.phone,
        mfaEnabled: await getMfaEnabled(result.identity.id),
        locale: result.identity.locale,
        roles: result.roles
      })
    );
  });
}
