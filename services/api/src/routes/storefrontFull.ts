import {
  addWishlistRequest,
  backInStockRequest,
  createReturnRequest,
  createReturnResponse,
  editReviewRequest,
  refundIbanRequest,
  refundIbanResponse,
  returnDetailResponse,
  returnEligibilityResponse,
  returnListResponse,
  reviewListResponse,
  streamTokenResponse,
  submitReviewRequest,
  submitReviewResponse,
  trackingResponse,
  wishlistResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withRlsTransaction, withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import { requirePermission } from "../gateway/requirePermission.js";
import { deliveryLocationChannel } from "../realtime/pusherClient.js";
import type { AccessTokenClaims } from "../security/jwt.js";

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

// SF-06 (live tracking) / SF-07 (returns) / SF-08 (reviews) / SF-09
// (wishlist), S13. SF-06 rides on DL-03's real Pusher channel
// (services/api/src/realtime/pusherClient.ts, S11) — the same
// deliveryLocationChannel() name both the driver's publish side and this
// customer-facing subscribe side agree on.
export function registerStorefrontFullRoutes(app: FastifyInstance): void {
  // EP-SF-040 · GET /orders/{id}/tracking · auth(owner)
  app.get<{ Params: { id: string } }>("/api/v1/orders/:id/tracking", async (request, reply) => {
    const actor = requireActor(request);
    const result = await withRlsTransaction(actor, async (client) => {
      const orderRes = await client.query<{ status: string }>("select status from orders.orders where id = $1 and user_id = $2", [
        request.params.id,
        actor.sub
      ]);
      if (orderRes.rowCount === 0) return null;

      const taskRes = await client.query<{
        id: string;
        status: string;
        eta: Date | null;
        driver_id: string | null;
        vehicle_desc: string | null;
        full_name: string | null;
      }>(
        `select t.id, t.status, t.eta, d.id as driver_id, d.vehicle_desc, i.full_name
         from delivery.delivery_tasks t
         left join delivery.drivers d on d.id = t.driver_id
         left join core.identities i on i.id = d.identity_id
         where t.order_id = $1 order by t.created_at desc limit 1`,
        [request.params.id]
      );
      const task = taskRes.rows[0];

      let lastLocation: { lat: number; lng: number; at: string } | null = null;
      if (task && task.status === "en_route") {
        const pingRes = await client.query<{ lat: string; lng: string; at: Date }>(
          "select lat, lng, at from delivery.location_pings where task_id = $1 order by at desc limit 1",
          [task.id]
        );
        if (pingRes.rows[0]) {
          lastLocation = { lat: Number(pingRes.rows[0].lat), lng: Number(pingRes.rows[0].lng), at: pingRes.rows[0].at.toISOString() };
        }
      }

      let otp: string | null = null;
      if (task && ["en_route", "arrived"].includes(task.status)) {
        const otpRes = await client.query<{ otp_code: string | null }>("select otp_code from delivery.delivery_tasks where id = $1", [
          task.id
        ]);
        otp = otpRes.rows[0]?.otp_code ?? null;
      }

      return {
        status: orderRes.rows[0]!.status,
        task,
        lastLocation,
        otp,
        // FR-SF06-005: driver fields only while the task is active.
        driverActive: task ? !["delivered", "confirmed", "failed"].includes(task.status) : false
      };
    });
    if (!result) throw new ApiError("NOT_FOUND");

    return reply.code(200).send(
      trackingResponse.parse({
        status: result.status,
        eta: result.task?.eta ? result.task.eta.toISOString() : null,
        driver:
          result.task?.driver_id && result.driverActive
            ? { displayName: result.task.full_name ?? "", vehicle: result.task.vehicle_desc }
            : null,
        otp: result.otp,
        taskId: result.task?.id ?? null,
        lastLocation: result.lastLocation
      })
    );
  });

  // EP-SF-041 · GET /orders/{id}/tracking/stream-token · auth(owner)
  app.get<{ Params: { id: string } }>("/api/v1/orders/:id/tracking/stream-token", async (request, reply) => {
    const actor = requireActor(request);
    const taskId = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ id: string }>(
        `select t.id from delivery.delivery_tasks t join orders.orders o on o.id = t.order_id
         where t.order_id = $1 and o.user_id = $2 order by t.created_at desc limit 1`,
        [request.params.id, actor.sub]
      );
      return res.rows[0]?.id ?? null;
    });
    if (!taskId) throw new ApiError("NOT_FOUND");

    const auth = request.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    const expiresIn = actor.exp ? Math.max(0, actor.exp - Math.floor(Date.now() / 1000)) : 0;

    return reply.code(200).send(
      streamTokenResponse.parse({
        channel: deliveryLocationChannel(taskId),
        statusChannel: `orders-${request.params.id}-status`,
        token,
        expiresIn
      })
    );
  });

  // EP-SF-050 · GET /orders/{id}/return-eligibility · auth
  app.get<{ Params: { id: string } }>("/api/v1/orders/:id/return-eligibility", async (request, reply) => {
    const actor = requireActor(request);
    const result = await withRlsTransaction(actor, async (client) => {
      const orderRes = await client.query("select 1 from orders.orders where id = $1 and user_id = $2", [
        request.params.id,
        actor.sub
      ]);
      if (orderRes.rowCount === 0) return null;

      const deliveredRes = await client.query<{ min: Date | null }>(
        "select min(at) from orders.status_history where order_id = $1 and status = 'delivered'",
        [request.params.id]
      );
      const deliveredAt = deliveredRes.rows[0]?.min ?? null;
      const windowClosesAt = deliveredAt ? new Date(deliveredAt.getTime() + 7 * 86400_000) : null;
      const eligible = windowClosesAt !== null && windowClosesAt > new Date();

      const linesRes = await client.query<{ id: string; sku_slug: string; qty: number }>(
        "select id, sku_slug, qty from orders.order_lines where order_id = $1",
        [request.params.id]
      );
      return { windowClosesAt, eligible, lines: linesRes.rows };
    });
    if (!result) throw new ApiError("NOT_FOUND");

    return reply.code(200).send(
      returnEligibilityResponse.parse({
        eligible: result.eligible,
        windowClosesAt: result.windowClosesAt ? result.windowClosesAt.toISOString() : null,
        lines: result.eligible ? result.lines.map((l) => ({ orderLineId: l.id, slug: l.sku_slug, qtyEligible: l.qty })) : []
      })
    );
  });

  // EP-SF-051 · POST /orders/{id}/returns · auth
  app.post<{ Params: { id: string } }>("/api/v1/orders/:id/returns", async (request, reply) => {
    const actor = requireActor(request);
    const body = createReturnRequest.parse(request.body);
    let returnId: string;
    try {
      returnId = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ request_return: string }>(
          "select orders.request_return($1, $2, $3, $4, $5) as request_return",
          [actor.sub, request.params.id, JSON.stringify(body.lines), body.reasonCode, body.note ?? null]
        );
        return res.rows[0]!.request_return;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
      if (message.includes("RETURN_WINDOW_CLOSED")) throw new ApiError("RETURN_WINDOW_CLOSED");
      if (message.includes("VALIDATION_ERROR")) throw new ApiError("VALIDATION_ERROR");
      throw err;
    }
    return reply.code(201).send(createReturnResponse.parse({ returnId, status: "requested" }));
  });

  interface ReturnListRow {
    id: string;
    order_id: string;
    status: string;
    created_at: Date;
  }
  interface ReturnListCursor {
    createdAt: string;
    id: string;
  }

  // EP-SF-052 · GET /returns · auth
  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/api/v1/returns", async (request, reply) => {
    const actor = requireActor(request);
    const { cursor, limit } = parsePagination(request.query);
    const after = cursor ? decodeCursor<ReturnListCursor>(cursor) : null;

    const rows = await withRlsTransaction(actor, async (client) => {
      const params: unknown[] = [actor.sub];
      let where = "user_id = $1";
      if (after) {
        params.push(after.createdAt, after.id);
        where += ` and (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
      }
      params.push(limit + 1);
      const res = await client.query<ReturnListRow>(
        `select id, order_id, status, created_at from orders.returns where ${where} order by created_at desc, id desc limit $${params.length}`,
        params
      );
      return res.rows;
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? encodeCursor({ createdAt: page[page.length - 1]!.created_at.toISOString(), id: page[page.length - 1]!.id })
      : null;

    return reply.code(200).send(
      returnListResponse.parse(
        buildPage(
          page.map((r) => ({ returnId: r.id, orderId: r.order_id, status: r.status, createdAt: r.created_at.toISOString() })),
          nextCursor
        )
      )
    );
  });

  // EP-SF-053 · GET /returns/{id} · auth
  app.get<{ Params: { id: string } }>("/api/v1/returns/:id", async (request, reply) => {
    const actor = requireActor(request);
    const result = await withRlsTransaction(actor, async (client) => {
      const returnRes = await client.query(
        "select id, order_id, status, reason_code, note, created_at from orders.returns where id = $1 and user_id = $2",
        [request.params.id, actor.sub]
      );
      const returnRow = returnRes.rows[0];
      if (!returnRow) return null;
      const linesRes = await client.query("select order_line_id, qty, unopened from orders.return_lines where return_id = $1", [
        request.params.id
      ]);
      const refundRes = await client.query("select amount, status from orders.refunds where return_id = $1 limit 1", [
        request.params.id
      ]);
      return { returnRow, lines: linesRes.rows, refund: refundRes.rows[0] ?? null };
    });
    if (!result) throw new ApiError("NOT_FOUND");

    return reply.code(200).send(
      returnDetailResponse.parse({
        returnItem: {
          returnId: result.returnRow.id,
          orderId: result.returnRow.order_id,
          status: result.returnRow.status,
          reasonCode: result.returnRow.reason_code,
          note: result.returnRow.note,
          createdAt: result.returnRow.created_at.toISOString()
        },
        lines: result.lines.map((l: { order_line_id: string; qty: number; unopened: boolean }) => ({
          orderLineId: l.order_line_id,
          qty: l.qty,
          unopened: l.unopened
        })),
        refund: result.refund ? { amount: money(Number(result.refund.amount)), status: result.refund.status } : null
      })
    );
  });

  // EP-SF-054 · POST /returns/{id}/refund-iban · auth
  app.post<{ Params: { id: string } }>("/api/v1/returns/:id/refund-iban", async (request, reply) => {
    const actor = requireActor(request);
    const body = refundIbanRequest.parse(request.body);
    await withServiceRoleTransaction(async (client) => {
      const ret = await client.query<{ order_id: string }>("select order_id from orders.returns where id = $1 and user_id = $2", [
        request.params.id,
        actor.sub
      ]);
      if (ret.rowCount === 0) throw new ApiError("NOT_FOUND");
      await client.query(
        `insert into orders.refunds (order_id, return_id, amount, iban) values ($1, $2, 0, $3)
         on conflict do nothing`,
        [ret.rows[0]!.order_id, request.params.id, body.iban]
      );
    });
    return reply.code(200).send(refundIbanResponse.parse({ status: "pending" }));
  });

  // EP-SF-060 · POST /catalog/products/{slug}/reviews · auth
  app.post<{ Params: { slug: string } }>(
    "/api/v1/catalog/products/:slug/reviews",
    { preHandler: requirePermission("create", "review") },
    async (request, reply) => {
      const actor = requireActor(request);
      const body = submitReviewRequest.parse(request.body);
      let reviewId: string;
      try {
        reviewId = await withServiceRoleTransaction(async (client) => {
          const skuRes = await client.query<{ id: string }>("select id from catalog.skus where slug = $1 and is_active", [
            request.params.slug
          ]);
          if (skuRes.rowCount === 0) throw new ApiError("NOT_FOUND");
          const res = await client.query<{ submit_review: string }>("select orders.submit_review($1, $2, $3, $4) as submit_review", [
            actor.sub,
            skuRes.rows[0]!.id,
            body.stars,
            body.body ?? null
          ]);
          return res.rows[0]!.submit_review;
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_VERIFIED_PURCHASE")) throw new ApiError("NOT_VERIFIED_PURCHASE");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(201).send(submitReviewResponse.parse({ reviewId, status: "pending" }));
    }
  );

  interface ReviewListCursor {
    createdAt: string;
    id: string;
  }

  // EP-SF-061 · GET /catalog/products/{slug}/reviews · public
  app.get<{ Params: { slug: string }; Querystring: { cursor?: string; limit?: string } }>(
    "/api/v1/catalog/products/:slug/reviews",
    async (request, reply) => {
      const { cursor, limit } = parsePagination(request.query);
      const after = cursor ? decodeCursor<ReviewListCursor>(cursor) : null;

      const result = await withServiceRoleTransaction(async (client) => {
        const skuRes = await client.query<{ id: string }>("select id from catalog.skus where slug = $1", [request.params.slug]);
        if (skuRes.rowCount === 0) return null;
        const skuId = skuRes.rows[0]!.id;

        const params: unknown[] = [skuId];
        let where = "r.sku_id = $1 and r.status = 'approved'";
        if (after) {
          params.push(after.createdAt, after.id);
          where += ` and (r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
        }
        params.push(limit + 1);
        const itemsRes = await client.query<{ id: string; stars: number; body: string | null; created_at: Date; full_name: string }>(
          `select r.id, r.stars, r.body, r.created_at, i.full_name
           from orders.reviews r join core.identities i on i.id = r.user_id
           where ${where} order by r.created_at desc, r.id desc limit $${params.length}`,
          params
        );
        const summaryRes = await client.query<{ avg_stars: string | null; review_count: string }>(
          "select avg_stars, review_count from orders.v_sku_review_summary where sku_id = $1",
          [skuId]
        );
        return { items: itemsRes.rows, summary: summaryRes.rows[0] ?? null };
      });
      if (!result) throw new ApiError("NOT_FOUND");

      const hasMore = result.items.length > limit;
      const page = hasMore ? result.items.slice(0, limit) : result.items;
      const nextCursor = hasMore
        ? encodeCursor({ createdAt: page[page.length - 1]!.created_at.toISOString(), id: page[page.length - 1]!.id })
        : null;

      return reply.code(200).send(
        reviewListResponse.parse({
          items: page.map((r) => ({
            stars: r.stars,
            body: r.body,
            // FR-SF08-006 [BUSINESS-CONFIRM reading]: a display name, not the
            // raw full name field verbatim — first name + last-initial is the
            // conservative default (D-17) absent a spec'd masking rule.
            authorDisplay: r.full_name.split(" ")[0] + (r.full_name.split(" ")[1] ? ` ${r.full_name.split(" ")[1]![0]}.` : ""),
            createdAt: r.created_at.toISOString()
          })),
          nextCursor,
          summary: { avg: result.summary ? Number(result.summary.avg_stars) : 0, count: result.summary ? Number(result.summary.review_count) : 0 }
        })
      );
    }
  );

  // EP-SF-062 · PATCH /reviews/{id} · auth
  app.patch<{ Params: { id: string } }>("/api/v1/reviews/:id", async (request, reply) => {
    const actor = requireActor(request);
    const body = editReviewRequest.parse(request.body);
    try {
      await withServiceRoleTransaction(async (client) => {
        await client.query("select orders.edit_review($1, $2, $3, $4)", [
          request.params.id,
          actor.sub,
          body.stars ?? null,
          body.body ?? null
        ]);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
      if (message.includes("REVIEW_EDIT_WINDOW_CLOSED")) throw new ApiError("REVIEW_EDIT_WINDOW_CLOSED");
      throw err;
    }
    return reply.code(200).send({ status: "updated" });
  });

  // EP-SF-063 · DELETE /reviews/{id} · auth
  app.delete<{ Params: { id: string } }>("/api/v1/reviews/:id", async (request, reply) => {
    const actor = requireActor(request);
    try {
      await withServiceRoleTransaction(async (client) => {
        await client.query("select orders.delete_review($1, $2)", [request.params.id, actor.sub]);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
      if (message.includes("REVIEW_EDIT_WINDOW_CLOSED")) throw new ApiError("REVIEW_EDIT_WINDOW_CLOSED");
      throw err;
    }
    return reply.code(204).send();
  });

  // EP-SF-070 · GET /wishlist · auth
  app.get("/api/v1/wishlist", async (request, reply) => {
    const actor = requireActor(request);
    const items = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ sku_id: string; slug: string; name_ar: string; name_en: string; back_in_stock_optin: boolean }>(
        `select w.sku_id, s.slug, s.name_ar, s.name_en, w.back_in_stock_optin
         from orders.wishlist_items w join catalog.skus s on s.id = w.sku_id
         where w.user_id = $1 order by w.created_at desc`,
        [actor.sub]
      );
      const withStock = [];
      for (const row of res.rows) {
        const stockRes = await client.query<{ in_stock: boolean }>(
          `select bool_or(v.in_stock) as in_stock from catalog.v_sku_availability v
           join catalog.pack_sizes p on p.id = v.pack_size_id where p.sku_id = $1`,
          [row.sku_id]
        );
        withStock.push({ ...row, anyInStock: stockRes.rows[0]?.in_stock ?? false });
      }
      return withStock;
    });
    return reply.code(200).send(
      wishlistResponse.parse({
        items: items.map((i) => ({
          skuId: i.sku_id,
          slug: i.slug,
          nameAr: i.name_ar,
          nameEn: i.name_en,
          anyInStock: i.anyInStock,
          backInStockOptin: i.back_in_stock_optin
        }))
      })
    );
  });

  // EP-SF-071 · POST /wishlist · auth
  app.post("/api/v1/wishlist", async (request, reply) => {
    const actor = requireActor(request);
    const body = addWishlistRequest.parse(request.body);
    await withRlsTransaction(actor, async (client) => {
      await client.query(
        "insert into orders.wishlist_items (user_id, sku_id) values ($1, $2) on conflict (user_id, sku_id) do nothing",
        [actor.sub, body.skuId]
      );
    });
    return reply.code(201).send();
  });

  // EP-SF-072 · DELETE /wishlist/{skuId} · auth
  app.delete<{ Params: { skuId: string } }>("/api/v1/wishlist/:skuId", async (request, reply) => {
    const actor = requireActor(request);
    await withRlsTransaction(actor, async (client) => {
      await client.query("delete from orders.wishlist_items where user_id = $1 and sku_id = $2", [actor.sub, request.params.skuId]);
    });
    return reply.code(204).send();
  });

  // EP-SF-073 · POST /wishlist/{skuId}/back-in-stock · auth
  app.post<{ Params: { skuId: string } }>("/api/v1/wishlist/:skuId/back-in-stock", async (request, reply) => {
    const actor = requireActor(request);
    const body = backInStockRequest.parse(request.body);
    const updated = await withRlsTransaction(actor, async (client) => {
      const res = await client.query(
        "update orders.wishlist_items set back_in_stock_optin = $3 where user_id = $1 and sku_id = $2",
        [actor.sub, request.params.skuId, body.optin]
      );
      return res.rowCount ?? 0;
    });
    if (updated === 0) throw new ApiError("NOT_FOUND");
    return reply.code(200).send({ status: "updated" });
  });
}
