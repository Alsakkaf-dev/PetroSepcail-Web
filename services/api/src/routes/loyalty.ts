import {
  activeCampaignsResponse,
  pointsBalanceResponse,
  pointsHistoryResponse,
  redemptionQuoteRequest,
  redemptionQuoteResponse,
  rewardListResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withRlsTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import type { AccessTokenClaims } from "../security/jwt.js";

// 50-loyalty-engine/05-api-specification.md (LE-01/05/07, S19/S20).

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

export function registerLoyaltyRoutes(app: FastifyInstance): void {
  // EP-LE-001 · GET /loyalty/points/balance · auth(customer)
  app.get("/api/v1/loyalty/points/balance", async (request, reply) => {
    const actor = requireActor(request);
    const balance = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ balance: string }>(
        "select coalesce(sum(points), 0) as balance from loyalty.points_ledger where user_id = $1",
        [actor.sub]
      );
      return Number(res.rows[0]?.balance ?? 0);
    });
    return reply.code(200).send(pointsBalanceResponse.parse({ balance }));
  });

  // EP-LE-002 · GET /loyalty/points/history · auth(customer)
  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/api/v1/loyalty/points/history", async (request, reply) => {
    const actor = requireActor(request);
    const { cursor, limit } = parsePagination(request.query);
    const after = cursor ? decodeCursor<{ createdAt: string; id: string }>(cursor) : null;

    const rows = await withRlsTransaction(actor, async (client) => {
      const conditions = ["user_id = $1"];
      const params: unknown[] = [actor.sub];
      if (after) {
        params.push(after.createdAt, after.id);
        conditions.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
      }
      params.push(limit + 1);
      const res = await client.query<{ id: string; kind: string; points: number; order_id: string | null; created_at: Date }>(
        `select id, kind, points, order_id, created_at from loyalty.points_ledger
         where ${conditions.join(" and ")} order by created_at desc, id desc limit $${params.length}`,
        params
      );
      return res.rows;
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor({ createdAt: page[page.length - 1]!.created_at.toISOString(), id: page[page.length - 1]!.id }) : null;

    return reply.code(200).send(
      pointsHistoryResponse.parse(
        buildPage(
          page.map((r) => ({ kind: r.kind, points: r.points, orderId: r.order_id, at: r.created_at.toISOString() })),
          nextCursor
        )
      )
    );
  });

  // EP-X-003 · POST /loyalty/redemption/quote · auth(customer) — never throws.
  app.post("/api/v1/loyalty/redemption/quote", async (request, reply) => {
    const actor = requireActor(request);
    const body = redemptionQuoteRequest.parse(request.body);
    const quote = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ result: { allowedPoints: number; discountSar: string } }>(
        "select loyalty.quote_redemption($1, $2, $3) as result",
        [actor.sub, body.pointsRequested, body.orderTotal]
      );
      return res.rows[0]!.result;
    });
    return reply.code(200).send(redemptionQuoteResponse.parse({ allowedPoints: quote.allowedPoints, discountSar: money(Number(quote.discountSar)) }));
  });

  // EP-LE-030 · GET /supplier/rewards · auth(supplier)
  app.get("/api/v1/supplier/rewards", async (request, reply) => {
    const actor = requireActor(request);
    if (actor.role !== "supplier" || !actor.supplier_id) throw new ApiError("FORBIDDEN");
    const rows = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ kind: string; value_sar: string; source_ref: string | null; created_at: Date }>(
        "select kind, value_sar, source_ref, created_at from loyalty.incentives where supplier_id = $1 order by created_at desc",
        [actor.supplier_id]
      );
      return res.rows;
    });
    return reply.code(200).send(
      rewardListResponse.parse({
        items: rows.map((r) => ({ kind: r.kind, valueSar: money(Number(r.value_sar)), sourceRef: r.source_ref, createdAt: r.created_at.toISOString() }))
      })
    );
  });

  // EP-LE-040 · GET /loyalty/campaigns/active · auth
  app.get("/api/v1/loyalty/campaigns/active", async (request, reply) => {
    const actor = requireActor(request);
    const rows = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ id: string; name_ar: string; name_en: string; ends_at: Date }>(
        "select id, name_ar, name_en, ends_at from loyalty.campaigns where status = 'active' order by ends_at"
      );
      return res.rows;
    });
    return reply.code(200).send(
      activeCampaignsResponse.parse({ items: rows.map((r) => ({ id: r.id, nameAr: r.name_ar, nameEn: r.name_en, endsAt: r.ends_at.toISOString() })) })
    );
  });
}
