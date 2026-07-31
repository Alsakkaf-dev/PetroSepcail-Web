import Pusher from "pusher";

// DL-03 (S11) / ADR-16: the officially decided realtime vendor is Pusher
// Channels — but services/realtime (S04) still runs its own self-built `ws`
// WebSocketServer, which cannot run on Vercel's serverless model at all (no
// persistent process to hold connections; confirmed there is no 5th Vercel
// project for it, unlike store/admin/api/driver). PUSHER_* env vars have
// existed in .env.example since that ADR but nothing in this codebase
// actually called the Pusher SDK until this file. This is the real
// integration, not a stub: it degrades to a no-op (logged, not thrown) when
// unconfigured, the same posture media/minioClient.ts already uses for an
// optional external dependency, so local dev without a real Pusher account
// still works for everything except the live-push (pings are still
// durably stored either way — see routes/driverDelivery.ts's pings handler).
let client: Pusher | undefined;
let attempted = false;

function getClient(): Pusher | null {
  if (attempted) return client ?? null;
  attempted = true;
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER;
  if (!appId || !key || !secret || !cluster) return null;
  client = new Pusher({ appId, key, secret, cluster, useTLS: true });
  return client;
}

export async function triggerEvent(channel: string, event: string, data: Record<string, unknown>): Promise<void> {
  const pusher = getClient();
  if (!pusher) return; // unconfigured: durable DB write already happened, this is best-effort live push only
  await pusher.trigger(channel, event, data);
}

export function isPusherConfigured(): boolean {
  return getClient() !== null;
}

// 06-integration-contracts.md's channel name ("delivery:{taskId}:location")
// uses colons, written for the self-built WS server's own channelAuth.ts
// pattern-matching convention — but Pusher channel names may only contain
// [A-Za-z0-9_\-=@,.;], colons are rejected outright. Shared here so every
// caller (driver-side publish, customer-side subscribe token) agrees on the
// same real channel name.
export function deliveryLocationChannel(taskId: string): string {
  return `delivery-${taskId}-location`;
}
