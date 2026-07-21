import type { BroadcastToChannelFn } from "../server.js";
import { registerConsumer } from "./framework.js";

// EV-PC-001 identity.user.registered -> PC-06 welcome notification
// (06-integration-contracts.md §2 catalog: "Consumers: PC-06 (welcome), LE-04").
// In-app only: stores {type, params}, not pre-rendered text — the client
// renders `identity_welcome` using its own locale-aware template, the same
// way every other in-app notification type will (email rendering, which
// DOES need server-side text, is a separate concern already handled at
// registration time by services/api's deliverEmail(), not repeated here).
export function registerWelcomeNotificationConsumer(broadcastToChannel: BroadcastToChannelFn): void {
  registerConsumer("pc06.welcome-notification", async (envelope) => {
    const userId = envelope.payload.user_id as string;

    const { withServiceRoleTransaction } = await import("../db.js");
    const notification = await withServiceRoleTransaction(async (client) => {
      const res = await client.query<{ id: string; created_at: Date }>(
        `insert into core.notifications (identity_id, type, params)
         values ($1, 'identity_welcome', '{}'::jsonb)
         returning id, created_at`,
        [userId]
      );
      const row = res.rows[0]!;
      await client.query("insert into core.notification_log (notification_id, channel, status) values ($1, 'in_app', 'sent')", [
        row.id
      ]);
      return { id: row.id, type: "identity_welcome", params: {}, readAt: null, createdAt: row.created_at.toISOString() };
    });

    broadcastToChannel(`identity:${userId}:notifications`, notification);
  });
}
