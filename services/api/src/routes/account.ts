import {
  accountExportResponse,
  accountOverviewResponse,
  consentsResponse,
  consentsUpdateRequest,
  loyaltyOverviewResponse,
  notificationPreferencesResponse,
  notificationPreferencesUpdateRequest
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withRlsTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import type { AccessTokenClaims } from "../security/jwt.js";

function requireActor(request: { ctx: { actor: AccessTokenClaims | null } }): AccessTokenClaims {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  return actor;
}

// A static placeholder until a real versioned-policy-document mechanism
// exists (SPEC-GAP — 08-security-and-compliance.md never names a concrete
// version scheme). Recorded on every new consent row so a future migration
// to real versioning has something to key off of.
const POLICY_VERSION = "1.0";

// SF-10 (S09) — FR-SF10-*. Profile (EP-PC-011/012) and address book
// (EP-PC-013/014/015) already live in routes/me.ts and routes/addresses.ts;
// this file owns the SF-10-specific surfaces: EP-SF-080..084.
export function registerAccountRoutes(app: FastifyInstance): void {
  // EP-SF-080 · GET /account/overview · auth
  app.get("/api/v1/account/overview", async (request, reply) => {
    const actor = requireActor(request);
    const result = await withRlsTransaction(actor, async (client) => {
      const orders = await client.query<{ id: string; status: string; total: string; placed_at: Date }>(
        "select id, status, total, placed_at from orders.orders where user_id = $1 order by placed_at desc limit 5",
        [actor.sub]
      );
      const addressCount = await client.query<{ count: string }>(
        "select count(*) from core.addresses where identity_id = $1",
        [actor.sub]
      );
      return { orders: orders.rows, addressCount: Number(addressCount.rows[0]!.count) };
    });

    return reply.code(200).send(
      accountOverviewResponse.parse({
        recentOrders: result.orders.map((o) => ({
          orderId: o.id,
          status: o.status,
          total: o.total,
          placedAt: o.placed_at.toISOString()
        })),
        pointsBalance: 0, // FR-SF10-004 — LE-01 doesn't exist until S19, see /account/loyalty
        addressCount: result.addressCount,
        openReturns: 0 // SF-07 (returns) not built yet
      })
    );
  });

  // EP-SF-081 · GET /account/loyalty · auth — read-through LE-01 stub
  // (contract-honoring seam, same precedent as SF-03/S08's coupon stub).
  app.get("/api/v1/account/loyalty", async (request, reply) => {
    const actor = requireActor(request);
    const rate = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ get_setting: string }>("select core.get_setting('redeem_rate') as get_setting");
      return Number(res.rows[0]?.get_setting ?? 0.05);
    });
    return reply.code(200).send(
      loyaltyOverviewResponse.parse({
        balance: 0,
        redeemRate: { points: 100, sar: 100 * rate },
        entries: []
      })
    );
  });

  // EP-SF-082 · GET /account/notification-preferences · auth
  app.get("/api/v1/account/notification-preferences", async (request, reply) => {
    const actor = requireActor(request);
    const rows = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ notification_type: string; channel: string; enabled: boolean }>(
        "select notification_type, channel, enabled from core.notification_preferences where identity_id = $1",
        [actor.sub]
      );
      return res.rows;
    });
    return reply.code(200).send(
      notificationPreferencesResponse.parse({
        items: rows.map((r) => ({ notificationType: r.notification_type, channel: r.channel, enabled: r.enabled }))
      })
    );
  });

  // EP-SF-082 · PUT /account/notification-preferences · auth
  app.put("/api/v1/account/notification-preferences", async (request, reply) => {
    const actor = requireActor(request);
    const body = notificationPreferencesUpdateRequest.parse(request.body);
    const rows = await withRlsTransaction(actor, async (client) => {
      for (const item of body.items) {
        await client.query(
          `insert into core.notification_preferences (identity_id, notification_type, channel, enabled)
           values ($1, $2, $3, $4)
           on conflict (identity_id, notification_type, channel) do update set enabled = excluded.enabled`,
          [actor.sub, item.notificationType, item.channel, item.enabled]
        );
      }
      const res = await client.query<{ notification_type: string; channel: string; enabled: boolean }>(
        "select notification_type, channel, enabled from core.notification_preferences where identity_id = $1",
        [actor.sub]
      );
      return res.rows;
    });
    return reply.code(200).send(
      notificationPreferencesResponse.parse({
        items: rows.map((r) => ({ notificationType: r.notification_type, channel: r.channel, enabled: r.enabled }))
      })
    );
  });

  // EP-SF-083 · GET /account/consents · auth — latest row per kind (append-only ledger).
  app.get("/api/v1/account/consents", async (request, reply) => {
    const actor = requireActor(request);
    const rows = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ kind: string; granted: boolean; policy_version: string; at: Date }>(
        `select distinct on (kind) kind, granted, policy_version, at
         from core.consents where identity_id = $1 order by kind, at desc`,
        [actor.sub]
      );
      return res.rows;
    });
    return reply.code(200).send(
      consentsResponse.parse({
        items: rows.map((r) => ({ kind: r.kind, granted: r.granted, policyVersion: r.policy_version, at: r.at.toISOString() }))
      })
    );
  });

  // EP-SF-083 · PATCH /account/consents · auth — FR-SF10-006: withdraw
  // marketing immediately (the only consent this endpoint can change; the
  // other two kinds are accepted at registration/checkout, not editable here).
  app.patch("/api/v1/account/consents", async (request, reply) => {
    const actor = requireActor(request);
    const body = consentsUpdateRequest.parse(request.body);
    await withRlsTransaction(actor, async (client) => {
      await client.query(
        `insert into core.consents (identity_id, kind, granted, policy_version) values ($1, 'marketing', $2, $3)`,
        [actor.sub, body.marketing, POLICY_VERSION]
      );
    });
    return reply.code(204).send();
  });

  // EP-SF-084 · POST /account/export · auth — FR-SF10-008 (SHOULD). SPEC-GAP:
  // synchronous 200, not the doc's 202-then-poll job shape (see
  // packages/contracts/src/sf-account.ts's own comment on accountExportResponse).
  app.post("/api/v1/account/export", async (request, reply) => {
    const actor = requireActor(request);
    const data = await withRlsTransaction(actor, async (client) => {
      const identity = await client.query(
        "select id, full_name, email, phone, locale from core.identities where id = $1",
        [actor.sub]
      );
      const addresses = await client.query("select * from core.addresses where identity_id = $1", [actor.sub]);
      const orders = await client.query(
        "select id, status, total, placed_at from orders.orders where user_id = $1 order by placed_at desc",
        [actor.sub]
      );
      return { identity: identity.rows[0] ?? {}, addresses: addresses.rows, orders: orders.rows };
    });
    return reply.code(200).send(
      accountExportResponse.parse({
        generatedAt: new Date().toISOString(),
        identity: data.identity,
        addresses: data.addresses,
        orders: data.orders
      })
    );
  });
}
