import { meResponse } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withRlsTransaction } from "../db.js";
import { ApiError } from "../errors.js";

interface IdentityRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  locale: "ar" | "en";
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
        roles: result.roles
      })
    );
  });
}
