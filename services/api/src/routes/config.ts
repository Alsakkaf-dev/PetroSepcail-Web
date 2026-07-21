import {
  featureFlagUpdateRequest,
  featureFlagsListResponse,
  settingUpdateRequest,
  settingsListResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { publishEvent } from "../events/publishEvent.js";
import { requirePermission } from "../gateway/requirePermission.js";

interface ConfigRow {
  key: string;
  value: unknown;
  updated_by: string | null;
  updated_at: Date;
}

function toRow(row: ConfigRow) {
  return { key: row.key, value: row.value, updatedBy: row.updated_by, updatedAt: row.updated_at.toISOString() };
}

// EP-PC-040..043 (PC-12, S05). 04-roles-and-permissions-matrix §3's own
// "Platform config / feature flags" row (admin: R, super_admin: CRUD) —
// which that document self-declares as "the single authority on who may do
// what" — is stricter than 05-api-specification §5's per-endpoint
// "auth(admin)" shorthand on EP-PC-041/043 (which reads as though ordinary
// admins may write non-"dangerous" keys). SPEC-GAP, resolved by following
// the matrix: every write here requires super_admin regardless of key,
// which also makes the "dangerous keys" (payments/ZATCA) distinction moot —
// nothing an admin can write anyway. Flagged for 00-master/12-consistency-
// audit.md (S21) to reconcile the two docs.
export function registerConfigRoutes(app: FastifyInstance): void {
  app.get(
    "/api/v1/admin/settings",
    { preHandler: requirePermission("read", "platform_config") },
    async (_request, reply) => {
      const rows = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<ConfigRow>("select key, value, updated_by, updated_at from core.settings order by key");
        return res.rows;
      });
      return reply.code(200).send(settingsListResponse.parse(rows.map(toRow)));
    }
  );

  app.put<{ Params: { key: string } }>(
    "/api/v1/admin/settings/:key",
    { preHandler: requirePermission("update", "platform_config") },
    async (request, reply) => {
      const body = settingUpdateRequest.parse(request.body);
      const actor = request.ctx.actor!; // requirePermission already guarantees a non-null actor
      const row = await withServiceRoleTransaction(async (client) => {
        const before = await client.query<ConfigRow>("select value from core.settings where key = $1", [request.params.key]);
        const res = await client.query<ConfigRow>(
          `update core.settings set value = $2::jsonb, updated_by = $3, updated_at = now()
           where key = $1
           returning key, value, updated_by, updated_at`,
          [request.params.key, JSON.stringify(body.value), actor.sub]
        );
        // FR-PC12-001 AC1: "emits EV-PC-050 + an audit entry."
        await publishEvent(client, {
          name: "platform.config.changed",
          actorSub: actor.sub,
          actorRole: actor.role,
          payload: { key: request.params.key, old: before.rows[0]?.value ?? null, new: body.value }
        });
        await client.query(
          `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after)
           values ($1, $2, 'config_changed', 'core.settings', $3, $4, $5)`,
          [actor.sub, actor.role, request.params.key, before.rows[0]?.value ?? null, JSON.stringify(body.value)]
        );
        return res.rows[0];
      });
      return reply.code(200).send(settingRowOrNotFound(row));
    }
  );

  app.get(
    "/api/v1/admin/feature-flags",
    { preHandler: requirePermission("read", "platform_config") },
    async (_request, reply) => {
      const rows = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<ConfigRow>(
          "select key, value, updated_by, updated_at from core.feature_flags order by key"
        );
        return res.rows;
      });
      return reply.code(200).send(featureFlagsListResponse.parse(rows.map(toRow)));
    }
  );

  app.put<{ Params: { key: string } }>(
    "/api/v1/admin/feature-flags/:key",
    { preHandler: requirePermission("update", "platform_config") },
    async (request, reply) => {
      const body = featureFlagUpdateRequest.parse(request.body);
      const actor = request.ctx.actor!;
      const row = await withServiceRoleTransaction(async (client) => {
        const before = await client.query<ConfigRow>("select value from core.feature_flags where key = $1", [
          request.params.key
        ]);
        const res = await client.query<ConfigRow>(
          `update core.feature_flags set value = $2::jsonb, updated_by = $3, updated_at = now()
           where key = $1
           returning key, value, updated_by, updated_at`,
          [request.params.key, JSON.stringify(body.value), actor.sub]
        );
        await publishEvent(client, {
          name: "platform.config.changed",
          actorSub: actor.sub,
          actorRole: actor.role,
          payload: { key: request.params.key, old: before.rows[0]?.value ?? null, new: body.value }
        });
        await client.query(
          `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after)
           values ($1, $2, 'config_changed', 'core.feature_flags', $3, $4, $5)`,
          [actor.sub, actor.role, request.params.key, before.rows[0]?.value ?? null, JSON.stringify(body.value)]
        );
        return res.rows[0];
      });
      return reply.code(200).send(settingRowOrNotFound(row));
    }
  );
}

function settingRowOrNotFound(row: ConfigRow | undefined) {
  if (!row) throw new ApiError("NOT_FOUND"); // UPDATE ... WHERE key = $1 matched no row
  return toRow(row);
}
