import { notificationsListResponse } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withRlsTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";

interface NotificationRow {
  id: string;
  type: string;
  params: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
}

interface NotificationCursor {
  createdAt: string;
  id: string;
}

function toItem(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    params: row.params,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString()
  };
}

// EP-PC-020..022 (PC-06, S05). RLS-bound (app_user + claims) throughout —
// core.notifications' `notif_own` (select, S01) and `notif_own_update`
// (update, migration 0013) policies are the actual scoping; these handlers
// never need an explicit identity_id filter for correctness, only for query
// efficiency (same reasoning as routes/me.ts).
export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { unread?: string; cursor?: string; limit?: string } }>(
    "/api/v1/notifications",
    async (request, reply) => {
      const actor = request.ctx.actor;
      if (!actor) throw new ApiError("INVALID_CREDENTIALS");
      const { cursor, limit } = parsePagination(request.query);
      const unreadOnly = request.query.unread === "true";
      const after = cursor ? decodeCursor<NotificationCursor>(cursor) : null;

      const rows = await withRlsTransaction(actor, async (client) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (unreadOnly) conditions.push("read_at is null");
        if (after) {
          params.push(after.createdAt, after.id);
          conditions.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
        }
        params.push(limit + 1);
        const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
        const res = await client.query<NotificationRow>(
          `select id, type, params, read_at, created_at from core.notifications
           ${where}
           order by created_at desc, id desc
           limit $${params.length}`,
          params
        );
        return res.rows;
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? encodeCursor({ createdAt: page[page.length - 1]!.created_at.toISOString(), id: page[page.length - 1]!.id })
        : null;

      return reply.code(200).send(notificationsListResponse.parse(buildPage(page.map(toItem), nextCursor)));
    }
  );

  app.post<{ Params: { id: string } }>("/api/v1/notifications/:id/read", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");
    await withRlsTransaction(actor, async (client) => {
      // RLS scopes this to the caller's own row regardless; a non-owned or
      // non-existent id just matches 0 rows (FR-PC02-003: no "not found" vs
      // "not yours" leakage — same shape either way).
      await client.query("update core.notifications set read_at = now() where id = $1 and read_at is null", [
        request.params.id
      ]);
    });
    return reply.code(204).send();
  });

  app.post("/api/v1/notifications/read-all", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");
    await withRlsTransaction(actor, async (client) => {
      await client.query("update core.notifications set read_at = now() where read_at is null");
    });
    return reply.code(204).send();
  });
}
