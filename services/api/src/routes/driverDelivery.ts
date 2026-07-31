import {
  acceptTaskResponse,
  auditCountRequest,
  auditCountResponse,
  auditListResponse,
  declineTaskResponse,
  driverKpisResponse,
  failTaskRequest,
  failTaskResponse,
  manifestResponse,
  otpRegenerateResponse,
  pingsRequest,
  pingsResponse,
  podRequest,
  podResponse,
  publishTokenResponse,
  returnToHubResponse,
  routeResponse,
  taskDetailResponse,
  transitionRequest,
  transitionResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withRlsTransaction, withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { requirePermission } from "../gateway/requirePermission.js";
import { getOptimizedRoute } from "../realtime/mapsClient.js";
import { deliveryLocationChannel, triggerEvent } from "../realtime/pusherClient.js";
import type { AccessTokenClaims } from "../security/jwt.js";

function requireDriver(request: { ctx: { actor: AccessTokenClaims | null } }): { actor: AccessTokenClaims; driverId: string } {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  if (actor.role !== "driver" || !actor.driver_id) throw new ApiError("FORBIDDEN");
  return { actor, driverId: actor.driver_id };
}

interface ManifestRow {
  task_id: string;
  order_id: string;
  stop_type: "b2b_drop" | "b2c_home" | "b2c_pickup";
  fulfillment_type: "home_delivery" | "pickup_point";
  status: string;
  route_sequence: number | null;
  eta: Date | null;
  label: string | null;
  line1: string | null;
  district: string | null;
  city: string | null;
  lat: string | null;
  lng: string | null;
}

function destinationLabel(row: ManifestRow): string {
  if (row.label) return row.label;
  if (row.line1) return [row.line1, row.district, row.city].filter(Boolean).join(", ");
  return "Pickup point"; // b2c_pickup: real supplier location detail lands with SP (S14/S16)
}

// DL-01 (dispatch)/DL-04 (state machine) driver-facing surface, S10.
// EP-DL-014 (route/ETA, Maps-sequenced) is DL-02/S11 — routeSequence here is
// whatever delivery.dispatch_order left null; nothing sequences it yet.
export function registerDriverDeliveryRoutes(app: FastifyInstance): void {
  // EP-DL-010 · GET /driver/manifest · auth(driver)
  app.get(
    "/api/v1/driver/manifest",
    { preHandler: requirePermission("read", "delivery_task") },
    async (request, reply) => {
      const { actor, driverId } = requireDriver(request);
      const rows = await withRlsTransaction(actor, async (client) => {
        const res = await client.query<ManifestRow>(
          `select t.id as task_id, t.order_id, t.stop_type, t.fulfillment_type, t.status,
                  t.route_sequence, t.eta, a.label, a.line1, a.district, a.city, a.lat, a.lng
           from delivery.delivery_tasks t
           left join core.addresses a on a.id = t.address_id
           where t.driver_id = $1 and t.status not in ('delivered','confirmed','failed')
           order by t.route_sequence nulls last, t.created_at`,
          [driverId]
        );
        const stops = [];
        for (const row of res.rows) {
          const lines = await client.query<{ sku_slug: string; name_ar: string; name_en: string; qty: number }>(
            "select sku_slug, name_ar, name_en, qty from delivery.driver_task_lines($1, $2)",
            [row.task_id, driverId]
          );
          stops.push({
            taskId: row.task_id,
            orderId: row.order_id,
            stopType: row.stop_type,
            fulfillmentType: row.fulfillment_type,
            status: row.status,
            routeSequence: row.route_sequence,
            destination: {
              label: destinationLabel(row),
              lat: row.lat === null ? null : Number(row.lat),
              lng: row.lng === null ? null : Number(row.lng)
            },
            eta: row.eta ? row.eta.toISOString() : null,
            lines: lines.rows.map((l) => ({ nameAr: l.name_ar, nameEn: l.name_en, qty: l.qty }))
          });
        }
        return stops;
      });
      return reply.code(200).send(manifestResponse.parse({ stops: rows }));
    }
  );

  // EP-DL-011 · POST /driver/tasks/{id}/accept · auth(driver)
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/tasks/:id/accept",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      let status: string;
      try {
        status = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ accept_task: string }>("select delivery.accept_task($1, $2) as accept_task", [
            request.params.id,
            driverId
          ]);
          return res.rows[0]!.accept_task;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("TASK_NOT_ASSIGNED")) throw new ApiError("TASK_NOT_ASSIGNED");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(acceptTaskResponse.parse({ status }));
    }
  );

  // EP-DL-012 · POST /driver/tasks/{id}/decline · auth(driver)
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/tasks/:id/decline",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      let status: string;
      try {
        status = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ decline_task: string }>("select delivery.decline_task($1, $2) as decline_task", [
            request.params.id,
            driverId
          ]);
          return res.rows[0]!.decline_task;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("TASK_NOT_ASSIGNED")) throw new ApiError("TASK_NOT_ASSIGNED");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(declineTaskResponse.parse({ status }));
    }
  );

  // EP-DL-013 · GET /driver/tasks/{id} · auth(driver)
  app.get<{ Params: { id: string } }>(
    "/api/v1/driver/tasks/:id",
    { preHandler: requirePermission("read", "delivery_task") },
    async (request, reply) => {
      const { actor, driverId } = requireDriver(request);
      const result = await withRlsTransaction(actor, async (client) => {
        const taskRes = await client.query<{
          id: string;
          order_id: string;
          stop_type: string;
          fulfillment_type: string;
          status: string;
          route_sequence: number | null;
          eta: Date | null;
          cod_amount: string | null;
          address_id: string | null;
        }>(
          `select id, order_id, stop_type, fulfillment_type, status, route_sequence, eta, cod_amount, address_id
           from delivery.delivery_tasks where id = $1 and driver_id = $2`,
          [request.params.id, driverId]
        );
        const task = taskRes.rows[0];
        if (!task) return null;

        const linesRes = await client.query<{ sku_slug: string; name_ar: string; name_en: string; qty: number }>(
          "select sku_slug, name_ar, name_en, qty from delivery.driver_task_lines($1, $2)",
          [task.id, driverId]
        );

        let recipient: { name: string; phone: string } | null = null;
        if (task.address_id) {
          const addrRes = await client.query<{ recipient_name: string; phone: string }>(
            "select recipient_name, phone from core.addresses where id = $1",
            [task.address_id]
          );
          if (addrRes.rows[0]) recipient = { name: addrRes.rows[0].recipient_name, phone: addrRes.rows[0].phone };
        }

        return { task, lines: linesRes.rows, recipient };
      });
      if (!result) throw new ApiError("NOT_FOUND");

      return reply.code(200).send(
        taskDetailResponse.parse({
          task: {
            taskId: result.task.id,
            orderId: result.task.order_id,
            stopType: result.task.stop_type,
            fulfillmentType: result.task.fulfillment_type,
            status: result.task.status,
            routeSequence: result.task.route_sequence,
            eta: result.task.eta ? result.task.eta.toISOString() : null
          },
          recipient: result.recipient,
          lines: result.lines.map((l) => ({ nameAr: l.name_ar, nameEn: l.name_en, qty: l.qty })),
          codAmount: result.task.cod_amount === null ? null : money(Number(result.task.cod_amount)),
          otpRequired: true // FR-DL04-007; the real OTP flow is EP-DL-040 (DL-05, S12)
        })
      );
    }
  );

  // EP-DL-014 · GET /driver/route · auth(driver) — DL-02 (S11). Origin is
  // the hub (catalog.stock_locations, D-14a single fulfillment origin) —
  // routing from a live driver position instead is a real future refinement
  // once DL-03's pings are being captured continuously, not this session's
  // scope. Only stops with a resolvable lat/lng (home_delivery) are routed;
  // pickup-point stops have no coordinate source yet (SP location directory
  // is S14/S16) and are left out of the leg sequence entirely rather than
  // guessed at.
  app.get(
    "/api/v1/driver/route",
    { preHandler: requirePermission("read", "delivery_task") },
    async (request, reply) => {
      const { actor, driverId } = requireDriver(request);
      const result = await withRlsTransaction(actor, async (client) => {
        const hubRes = await client.query<{ lat: string | null; lng: string | null }>(
          "select lat, lng from catalog.stock_locations where kind = 'hub' and is_active limit 1"
        );
        const hub = hubRes.rows[0];
        if (!hub?.lat || !hub.lng) return null;

        const stopsRes = await client.query<{ id: string; lat: string | null; lng: string | null }>(
          `select t.id, a.lat, a.lng from delivery.delivery_tasks t
           join core.addresses a on a.id = t.address_id
           where t.driver_id = $1 and t.status not in ('delivered','confirmed','failed')
           order by t.created_at`,
          [driverId]
        );
        const waypoints = stopsRes.rows
          .filter((r) => r.lat && r.lng)
          .map((r) => ({ taskId: r.id, lat: Number(r.lat), lng: Number(r.lng) }));
        if (waypoints.length === 0) return null;

        return getOptimizedRoute({ lat: Number(hub.lat), lng: Number(hub.lng) }, waypoints);
      });

      if (!result) return reply.code(200).send(routeResponse.parse({ legs: null, totalDurationS: null }));
      return reply.code(200).send(routeResponse.parse({ legs: result.legs, totalDurationS: result.totalDurationS }));
    }
  );

  // EP-DL-020 · POST /driver/tasks/{id}/transition · auth(driver) · clientActionId
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/tasks/:id/transition",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const body = transitionRequest.parse(request.body);
      let status: string;
      try {
        status = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ transition_task: string }>(
            "select delivery.transition_task($1, $2, $3, $4, $5, $6) as transition_task",
            [request.params.id, driverId, body.to, body.clientActionId, body.location?.lat ?? null, body.location?.lng ?? null]
          );
          return res.rows[0]!.transition_task;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("TASK_NOT_ASSIGNED")) throw new ApiError("TASK_NOT_ASSIGNED");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(transitionResponse.parse({ status }));
    }
  );

  // EP-DL-030 · POST /driver/tasks/{id}/pings · auth(driver) — DL-03 (S11).
  // Durable storage (delivery.location_pings) is unconditional; the live
  // push to the `delivery:{taskId}:location` channel via Pusher is
  // best-effort (pusherClient.ts no-ops if unconfigured) — only the LAST
  // ping in a batch is pushed live (an offline-reconnect flush can carry
  // many stale points at once; subscribers only ever care about "where is
  // the driver right now").
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/tasks/:id/pings",
    { preHandler: requirePermission("create", "driver_location") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const body = pingsRequest.parse(request.body);
      let accepted = 0;
      await withServiceRoleTransaction(async (client) => {
        const taskRes = await client.query<{ status: string }>(
          "select status from delivery.delivery_tasks where id = $1 and driver_id = $2",
          [request.params.id, driverId]
        );
        if (taskRes.rowCount === 0) throw new ApiError("TASK_NOT_ASSIGNED");

        for (const ping of body.pings) {
          const res = await client.query(
            `insert into delivery.location_pings (task_id, driver_id, lat, lng, heading, speed, at, client_ping_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             on conflict (task_id, client_ping_id) where client_ping_id is not null do nothing`,
            [request.params.id, driverId, ping.lat, ping.lng, ping.heading ?? null, ping.speed ?? null, ping.at, ping.clientPingId]
          );
          accepted += res.rowCount ?? 0;
        }
      });

      const latest = body.pings[body.pings.length - 1];
      if (latest) {
        await triggerEvent(deliveryLocationChannel(request.params.id), "ping", {
          lat: latest.lat,
          lng: latest.lng,
          heading: latest.heading ?? null,
          speed: latest.speed ?? null,
          at: latest.at
        });
      }

      return reply.code(202).send(pingsResponse.parse({ accepted }));
    }
  );

  // EP-DL-031 · GET /driver/tasks/{id}/publish-token · auth(driver) — DL-03.
  // SCOPED SIMPLIFICATION (documented): the API spec's "channel JWT the PWA
  // uses to publish" language assumes a client-direct-publish model. This
  // codebase's actual ping path is EP-DL-030 (driver -> our API -> Pusher
  // relay, above) — the driver never publishes to Pusher directly, so there
  // is no separate credential to mint. This endpoint stays contract-shaped
  // (the driver PWA can call it and get a real channel name back) but
  // returns the driver's own existing bearer token rather than a bespoke
  // Pusher auth signature, since nothing consumes it as one.
  app.get<{ Params: { id: string } }>(
    "/api/v1/driver/tasks/:id/publish-token",
    { preHandler: requirePermission("create", "driver_location") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const owns = await withServiceRoleTransaction(async (client) => {
        const res = await client.query("select 1 from delivery.delivery_tasks where id = $1 and driver_id = $2", [
          request.params.id,
          driverId
        ]);
        return (res.rowCount ?? 0) > 0;
      });
      if (!owns) throw new ApiError("TASK_NOT_ASSIGNED");

      const auth = request.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
      const actor = request.ctx.actor;
      const expiresIn = actor?.exp ? Math.max(0, actor.exp - Math.floor(Date.now() / 1000)) : 0;

      return reply.code(200).send(
        publishTokenResponse.parse({
          channel: deliveryLocationChannel(request.params.id),
          token,
          expiresIn
        })
      );
    }
  );

  // EP-DL-040 · POST /driver/tasks/{id}/pod · auth(driver) — DL-05 (S12).
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/tasks/:id/pod",
    { preHandler: requirePermission("create", "proof_of_delivery") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const body = podRequest.parse(request.body);
      let status: string;
      try {
        status = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ capture_pod: string }>(
            "select delivery.capture_pod($1, $2, $3, $4, $5, $6, $7, $8, $9) as capture_pod",
            [
              request.params.id,
              driverId,
              body.photoMediaId,
              body.otp ?? null,
              body.collectorKind,
              body.location?.lat ?? null,
              body.location?.lng ?? null,
              body.codCollectedAmount ?? null,
              body.clientActionId
            ]
          );
          return res.rows[0]!.capture_pod;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("TASK_NOT_ASSIGNED")) throw new ApiError("TASK_NOT_ASSIGNED");
        if (message.includes("OTP_MISMATCH")) throw new ApiError("OTP_MISMATCH");
        if (message.includes("POD_INCOMPLETE")) throw new ApiError("POD_INCOMPLETE");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(podResponse.parse({ status }));
    }
  );

  // EP-DL-041 · POST /driver/tasks/{id}/otp/regenerate · auth(driver)
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/tasks/:id/otp/regenerate",
    { preHandler: requirePermission("create", "proof_of_delivery") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      try {
        await withServiceRoleTransaction(async (client) => {
          await client.query("select delivery.regenerate_otp($1, $2)", [request.params.id, driverId]);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("TASK_NOT_ASSIGNED")) throw new ApiError("TASK_NOT_ASSIGNED");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(202).send(otpRegenerateResponse.parse({ status: "regenerated" }));
    }
  );

  // EP-DL-060 · POST /driver/tasks/{id}/fail · auth(driver) — DL-09 (S12).
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/tasks/:id/fail",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const body = failTaskRequest.parse(request.body);
      let status: string;
      try {
        status = await withServiceRoleTransaction(async (client) => {
          const res = await client.query<{ fail_task: string }>("select delivery.fail_task($1, $2, $3, $4, $5) as fail_task", [
            request.params.id,
            driverId,
            body.reasonCode,
            body.note ?? null,
            body.clientActionId
          ]);
          return res.rows[0]!.fail_task;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("TASK_NOT_ASSIGNED")) throw new ApiError("TASK_NOT_ASSIGNED");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(failTaskResponse.parse({ status }));
    }
  );

  // EP-DL-061 · POST /driver/tasks/{id}/return-to-hub · auth(driver)
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/tasks/:id/return-to-hub",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      try {
        await withServiceRoleTransaction(async (client) => {
          await client.query("select delivery.return_task_to_hub($1, $2)", [request.params.id, driverId]);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
        if (message.includes("TASK_NOT_ASSIGNED")) throw new ApiError("TASK_NOT_ASSIGNED");
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(returnToHubResponse.parse({ status: "returned" }));
    }
  );

  // EP-DL-070 · GET /driver/audits · auth(driver) — DL-06 (S12).
  app.get(
    "/api/v1/driver/audits",
    { preHandler: requirePermission("read", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const items = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ id: string; status: string; opened_at: Date }>(
          "select id, status, opened_at from delivery.stock_audits where entity_kind = 'driver' and entity_id = $1 order by opened_at desc",
          [driverId]
        );
        return res.rows.map((r) => ({ auditId: r.id, status: r.status, openedAt: r.opened_at.toISOString() }));
      });
      return reply.code(200).send(auditListResponse.parse({ items }));
    }
  );

  // EP-DL-071 · POST /driver/audits/{id}/count · auth(driver)
  app.post<{ Params: { id: string } }>(
    "/api/v1/driver/audits/:id/count",
    { preHandler: requirePermission("update", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const body = auditCountRequest.parse(request.body);
      let result: { variance: unknown; status: string };
      try {
        result = await withServiceRoleTransaction(async (client) => {
          const owns = await client.query(
            "select 1 from delivery.stock_audits where id = $1 and entity_kind = 'driver' and entity_id = $2",
            [request.params.id, driverId]
          );
          if (owns.rowCount === 0) throw new ApiError("NOT_FOUND");
          const res = await client.query<{ close_audit: { variance: unknown; status: string } }>(
            "select delivery.close_audit($1, $2) as close_audit",
            [request.params.id, JSON.stringify(body.counted)]
          );
          return res.rows[0]!.close_audit;
        });
      } catch (err) {
        if (err instanceof ApiError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
        throw err;
      }
      return reply.code(200).send(auditCountResponse.parse(result));
    }
  );

  // EP-DL-080 · GET /driver/kpis · auth(driver)
  app.get(
    "/api/v1/driver/kpis",
    { preHandler: requirePermission("read", "delivery_task") },
    async (request, reply) => {
      const { driverId } = requireDriver(request);
      const kpis = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ total: string; failed_count: string }>(
          `select count(*) as total, count(*) filter (where status = 'failed') as failed_count
           from delivery.delivery_tasks where driver_id = $1`,
          [driverId]
        );
        const row = res.rows[0]!;
        const total = Number(row.total);
        return {
          onTimePct: null, // no ETA-vs-actual tracking exists yet (needs DL-02 ETA + arrived timestamp comparison)
          avgTimeToDeliverMin: null, // needs assigned_at -> delivered timestamp aggregation, not built this session
          failedPct: total > 0 ? Number(((Number(row.failed_count) / total) * 100).toFixed(2)) : 0,
          reconAccuracyPct: null, // needs shift reconcile variance history aggregated, not built this session
          custodyOnTimePct: null // needs custody collected_at -> remitted_at SLA comparison, not built this session
        };
      });
      return reply.code(200).send(driverKpisResponse.parse(kpis));
    }
  );
}
