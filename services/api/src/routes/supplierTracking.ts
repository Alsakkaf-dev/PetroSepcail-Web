import {
  createTemplateRequest,
  streamTokenResponse,
  supplierPodResponse,
  supplierReorderResponse,
  templateListResponse,
  templateMutationResponse,
  trackingResponse,
  updateTemplateRequest
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withRlsTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { deliveryLocationChannel } from "../realtime/pusherClient.js";
import type { AccessTokenClaims } from "../security/jwt.js";

// 30-supplier-portal/05-api-specification.md §7/8 (SP-08/09, S16).

function requireSupplier(request: { ctx: { actor: AccessTokenClaims | null } }): { actor: AccessTokenClaims; supplierId: string } {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  if (actor.role !== "supplier" || !actor.supplier_id) throw new ApiError("FORBIDDEN");
  return { actor, supplierId: actor.supplier_id };
}

interface TemplateLineInput {
  packSizeId: string;
  qty: number;
}
interface TemplateRow {
  id: string;
  name: string;
  lines: TemplateLineInput[];
}

async function repriceLines(
  client: import("pg").PoolClient,
  lines: TemplateLineInput[]
): Promise<{ added: Array<{ packSizeId: string; skuSlug: string; qty: number; tierUnitPrice: string }>; dropped: Array<{ skuSlug: string; reason: "discontinued" | "out_of_stock" }> }> {
  const added: Array<{ packSizeId: string; skuSlug: string; qty: number; tierUnitPrice: string }> = [];
  const dropped: Array<{ skuSlug: string; reason: "discontinued" | "out_of_stock" }> = [];
  for (const line of lines) {
    const res = await client.query<{ slug: string; unit_price: string | null; in_stock: boolean | null }>(
      `select s.slug, tp.unit_price, a.in_stock
       from catalog.pack_sizes p
       join catalog.skus s on s.id = p.sku_id
       left join catalog.tier_prices tp on tp.pack_size_id = p.id
       left join catalog.v_sku_availability a on a.pack_size_id = p.id
       where p.id = $1 and p.is_active`,
      [line.packSizeId]
    );
    const row = res.rows[0];
    if (!row || row.unit_price === null) {
      dropped.push({ skuSlug: row?.slug ?? line.packSizeId, reason: "discontinued" });
      continue;
    }
    if (!row.in_stock) {
      dropped.push({ skuSlug: row.slug, reason: "out_of_stock" });
      continue;
    }
    added.push({ packSizeId: line.packSizeId, skuSlug: row.slug, qty: line.qty, tierUnitPrice: money(Number(row.unit_price)) });
  }
  return { added, dropped };
}

export function registerSupplierTrackingRoutes(app: FastifyInstance): void {
  // EP-SP-060 · GET /supplier/orders/{id}/tracking · auth(supplier) — same
  // shape/tables SF-06 (storefrontFull.ts) already uses, scoped by
  // user_id=actor.sub the same way (a wholesale order's user_id is the
  // supplier's own placing user, D-05 one-lifecycle).
  app.get<{ Params: { id: string } }>("/api/v1/supplier/orders/:id/tracking", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const result = await withRlsTransaction(actor, async (client) => {
      const orderRes = await client.query<{ status: string }>(
        "select status from orders.orders where id = $1 and user_id = $2 and kind = 'wholesale'",
        [request.params.id, actor.sub]
      );
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

      return {
        status: orderRes.rows[0]!.status,
        task,
        lastLocation,
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
        otp: null, // FR-SP08-001 — a wholesale drop is credit_terms, no OTP/COD collection gate
        taskId: result.task?.id ?? null,
        lastLocation: result.lastLocation
      })
    );
  });

  // EP-SP-061 · GET /supplier/orders/{id}/track-token · auth(supplier)
  app.get<{ Params: { id: string } }>("/api/v1/supplier/orders/:id/track-token", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const taskId = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ id: string }>(
        `select t.id from delivery.delivery_tasks t join orders.orders o on o.id = t.order_id
         where t.order_id = $1 and o.user_id = $2 and o.kind = 'wholesale' order by t.created_at desc limit 1`,
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

  // EP-SP-062 · GET /supplier/orders/{id}/pod · auth(supplier) — cross-role
  // read (the photo was uploaded by the driver, not the supplier), same
  // direct-scoped-join precedent orders.ts's own deliveryOtp read already
  // established rather than routing through the generic owner-only media
  // RLS policy (media_self_read) which would deny this legitimate read.
  app.get<{ Params: { id: string } }>("/api/v1/supplier/orders/:id/pod", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const row = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ object_key: string; bucket: string; captured_at: Date }>(
        `select m.object_key, m.bucket, p.captured_at
         from delivery.pods p
         join delivery.delivery_tasks t on t.id = p.task_id
         join orders.orders o on o.id = t.order_id
         join core.media_objects m on m.id = p.photo_media_id
         where t.order_id = $1 and o.user_id = $2 and o.kind = 'wholesale'`,
        [request.params.id, actor.sub]
      );
      return res.rows[0];
    });
    if (!row) throw new ApiError("NOT_FOUND");
    return reply.code(200).send(
      supplierPodResponse.parse({ photoUrl: `/api/v1/media/${row.object_key}/url`, deliveredAt: row.captured_at.toISOString() })
    );
  });

  // EP-SP-070 · GET/POST/PATCH/DELETE /supplier/templates · auth(supplier)
  app.get("/api/v1/supplier/templates", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const rows = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<TemplateRow>("select id, name, lines from credit.order_templates order by created_at desc");
      return res.rows;
    });
    return reply.code(200).send(
      templateListResponse.parse({ items: rows.map((r) => ({ templateId: r.id, name: r.name, lines: r.lines })) })
    );
  });

  app.post("/api/v1/supplier/templates", async (request, reply) => {
    const { actor, supplierId } = requireSupplier(request);
    const body = createTemplateRequest.parse(request.body);
    const row = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<TemplateRow>(
        "insert into credit.order_templates (supplier_id, name, lines) values ($1, $2, $3::jsonb) returning id, name, lines",
        [supplierId, body.name, JSON.stringify(body.lines)]
      );
      return res.rows[0]!;
    });
    return reply.code(201).send(templateMutationResponse.parse({ template: { templateId: row.id, name: row.name, lines: row.lines } }));
  });

  app.patch<{ Params: { id: string } }>("/api/v1/supplier/templates/:id", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const body = updateTemplateRequest.parse(request.body);
    const row = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<TemplateRow>(
        `update credit.order_templates set name = coalesce($2, name), lines = coalesce($3::jsonb, lines)
         where id = $1 returning id, name, lines`,
        [request.params.id, body.name ?? null, body.lines ? JSON.stringify(body.lines) : null]
      );
      return res.rows[0];
    });
    if (!row) throw new ApiError("NOT_FOUND");
    return reply.code(200).send(templateMutationResponse.parse({ template: { templateId: row.id, name: row.name, lines: row.lines } }));
  });

  app.delete<{ Params: { id: string } }>("/api/v1/supplier/templates/:id", async (request, reply) => {
    const { actor } = requireSupplier(request);
    await withRlsTransaction(actor, async (client) => {
      await client.query("delete from credit.order_templates where id = $1", [request.params.id]);
    });
    return reply.code(204).send();
  });

  // EP-SP-071 · POST /supplier/templates/{id}/reorder · auth(supplier)
  app.post<{ Params: { id: string } }>("/api/v1/supplier/templates/:id/reorder", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const result = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ lines: TemplateLineInput[] }>("select lines from credit.order_templates where id = $1", [
        request.params.id
      ]);
      if (!res.rows[0]) return null;
      return repriceLines(client, res.rows[0].lines);
    });
    if (!result) throw new ApiError("NOT_FOUND");
    return reply.code(200).send(supplierReorderResponse.parse(result));
  });

  // EP-SP-072 · POST /supplier/orders/{id}/reorder · auth(supplier)
  app.post<{ Params: { id: string } }>("/api/v1/supplier/orders/:id/reorder", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const result = await withRlsTransaction(actor, async (client) => {
      const linesRes = await client.query<TemplateLineInput>(
        `select ol.pack_size_id as "packSizeId", ol.qty from orders.order_lines ol
         join orders.orders o on o.id = ol.order_id
         where ol.order_id = $1 and o.user_id = $2 and o.kind = 'wholesale'`,
        [request.params.id, actor.sub]
      );
      if (linesRes.rows.length === 0) return null;
      return repriceLines(client, linesRes.rows);
    });
    if (!result) throw new ApiError("NOT_FOUND");
    return reply.code(200).send(supplierReorderResponse.parse(result));
  });
}
