import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The S04 Out contract, proven for real: "event round-trip demo works
// (publish -> outbox -> dispatch -> consumer -> WS)." Same ephemeral-Postgres
// pattern as services/api's E2E suites.
const CONTAINER = "ps-eventbus-e2e-test";

function dockerAvailable(): boolean {
  return spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
}

function stopContainer() {
  spawnSync("docker", ["stop", CONTAINER], { stdio: "ignore" });
}

async function waitForPostgres(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const client = new Client({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "test" });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres did not become ready within ${timeoutMs}ms`);
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("condition not met within timeout");
}

describe.runIf(dockerAvailable())("event bus round trip (PC-05): publish -> outbox -> dispatch -> consumer -> WS", () => {
  let dir: string;
  let dbClient: Client;
  let dispatcherHandle: { stop: () => Promise<void> };
  let httpServer: import("node:http").Server;
  let broadcastToChannelFn: (channel: string, payload: unknown) => void;
  let wsPort: number;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    execFileSync("docker", [
      "run", "--rm", "-d", "--name", CONTAINER,
      "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=test",
      "-p", "0:5432", "postgres:16-alpine"
    ]);
    const pgPort = Number(execFileSync("docker", ["port", CONTAINER, "5432"]).toString().trim().split(":").pop());
    await waitForPostgres(pgPort);
    const dbUrl = `postgres://postgres:test@127.0.0.1:${pgPort}/test`;

    execFileSync("npx", ["node-pg-migrate", "-m", "db/migrations", "--migration-file-language", "sql", "up"], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, DATABASE_URL: dbUrl }
    });

    dir = mkdtempSync(path.join(tmpdir(), "ps-eventbus-e2e-"));
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    writeFileSync(path.join(dir, "jwt_private.pem"), privateKey);
    writeFileSync(path.join(dir, "jwt_public.pem"), publicKey);

    process.env.DATABASE_URL = dbUrl;
    process.env.JWT_PRIVATE_KEY_PATH = path.join(dir, "jwt_private.pem");
    process.env.JWT_PUBLIC_KEY_PATH = path.join(dir, "jwt_public.pem");

    const { signAccessToken } = await import("@petrospecial/auth-shared");
    adminToken = await signAccessToken(
      { sub: "00000000-0000-0000-0000-000000000004", role: "admin", locale: "ar" },
      3600
    );
    customerToken = await signAccessToken(
      { sub: "00000000-0000-0000-0000-000000000001", role: "customer", locale: "ar" },
      3600
    );

    dbClient = new Client({ connectionString: dbUrl });
    await dbClient.connect();

    const { buildServer } = await import("./server.js");
    const { server, broadcast, broadcastToChannel } = buildServer();
    httpServer = server;
    broadcastToChannelFn = broadcastToChannel;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    wsPort = typeof address === "object" && address ? address.port : 0;

    const { createListenerClient } = await import("./db.js");
    const { startDispatcher } = await import("./dispatcher.js");
    const listenerClient = await createListenerClient();
    dispatcherHandle = startDispatcher(listenerClient, broadcast);
  }, 60_000);

  afterAll(async () => {
    await dispatcherHandle?.stop();
    await new Promise((resolve) => httpServer?.close(resolve));
    const { closePool } = await import("./db.js");
    await closePool();
    await dbClient?.end();
    rmSync(dir, { recursive: true, force: true });
    stopContainer();
  });

  it("delivers a published event to its consumer exactly once and broadcasts it over WS to a subscribed client", async () => {
    const { registerConsumer, clearConsumers } = await import("./consumers/framework.js");
    clearConsumers();
    const received: unknown[] = [];
    registerConsumer("demo.round-trip-consumer", async (envelope) => {
      received.push(envelope);
    });

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${adminToken}`);
    const wsMessages: Record<string, unknown>[] = [];
    ws.addEventListener("message", (ev) => wsMessages.push(JSON.parse(ev.data as string)));
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
    await waitFor(() => wsMessages.some((m) => m.type === "welcome"));

    ws.send(JSON.stringify({ type: "subscribe", channel: "events:demo.round_trip.happened" }));
    await waitFor(() => wsMessages.some((m) => m.type === "subscribed"));

    // "any subsystem" publishing an event — same shape services/api's
    // publishEvent() writes, done here directly against core.outbox to keep
    // this suite independent of the api service.
    const insertRes = await dbClient.query<{ event_id: string }>(
      `insert into core.outbox (name, version, actor_sub, actor_role, payload)
       values ('demo.round_trip.happened', 1, $1, 'admin', $2::jsonb)
       returning event_id`,
      ["00000000-0000-0000-0000-000000000004", JSON.stringify({ hello: "world" })]
    );
    const eventId = insertRes.rows[0]!.event_id;

    // Consumer ran (proves outbox -> NOTIFY -> dispatch -> consumer).
    await waitFor(() => received.length === 1);
    expect((received[0] as { eventId: string }).eventId).toBe(eventId);
    expect((received[0] as { payload: { hello: string } }).payload).toEqual({ hello: "world" });

    // WS broadcast happened (proves dispatch -> WS).
    await waitFor(() => wsMessages.some((m) => m.type === "event"));
    const eventMsg = wsMessages.find((m) => m.type === "event") as { event: { eventId: string; name: string } };
    expect(eventMsg.event.eventId).toBe(eventId);
    expect(eventMsg.event.name).toBe("demo.round_trip.happened");

    // Marked dispatched (proves the outbox row itself was updated).
    const row = await dbClient.query("select dispatched_at from core.outbox where event_id = $1", [eventId]);
    expect(row.rows[0].dispatched_at).not.toBeNull();

    // Idempotency ledger has exactly one row for this consumer+event.
    const processed = await dbClient.query(
      "select count(*)::int as n from core.processed_events where consumer_name = $1 and event_id = $2",
      ["demo.round-trip-consumer", eventId]
    );
    expect(processed.rows[0].n).toBe(1);

    ws.close();
  }, 15_000);

  it("re-running consumers against an already-processed event is a no-op (idempotency)", async () => {
    const { registerConsumer, clearConsumers, runConsumers } = await import("./consumers/framework.js");
    const { withServiceRoleTransaction } = await import("./db.js");
    clearConsumers();
    let callCount = 0;
    registerConsumer("demo.idempotency-consumer", async () => {
      callCount++;
    });

    const envelope = {
      eventId: "10000000-0000-0000-0000-000000000001",
      name: "demo.idempotency.test",
      version: 1,
      occurredAt: new Date().toISOString(),
      actor: { sub: null, role: null },
      payload: {}
    };

    await withServiceRoleTransaction(async (client) => {
      await runConsumers(client, envelope);
      await runConsumers(client, envelope); // redelivery, same transaction
    });
    expect(callCount).toBe(1);

    // A genuinely separate redelivery (new transaction) still no-ops.
    await withServiceRoleTransaction(async (client) => runConsumers(client, envelope));
    expect(callCount).toBe(1);
  });

  it("denies subscribing to admin:alerts with a non-admin token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${customerToken}`);
    const wsMessages: Record<string, unknown>[] = [];
    ws.addEventListener("message", (ev) => wsMessages.push(JSON.parse(ev.data as string)));
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
    await waitFor(() => wsMessages.some((m) => m.type === "welcome"));

    ws.send(JSON.stringify({ type: "subscribe", channel: "admin:alerts" }));
    await waitFor(() => wsMessages.some((m) => m.type === "subscribe_denied"));
    const denial = wsMessages.find((m) => m.type === "subscribe_denied");
    expect(denial).toEqual({ type: "subscribe_denied", channel: "admin:alerts" });

    ws.close();
  });

  it("welcome-notification consumer: EV-PC-001 creates an in-app notification and pushes it live (PC-06)", async () => {
    const { clearConsumers } = await import("./consumers/framework.js");
    const { registerWelcomeNotificationConsumer } = await import("./consumers/welcomeNotification.js");
    clearConsumers();
    registerWelcomeNotificationConsumer(broadcastToChannelFn);

    const customerId = "00000000-0000-0000-0000-000000000001"; // seeded customer (db/migrations/0008)
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/realtime?token=${customerToken}`);
    const wsMessages: Record<string, unknown>[] = [];
    ws.addEventListener("message", (ev) => wsMessages.push(JSON.parse(ev.data as string)));
    await new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
    await waitFor(() => wsMessages.some((m) => m.type === "welcome"));

    ws.send(JSON.stringify({ type: "subscribe", channel: `identity:${customerId}:notifications` }));
    await waitFor(() => wsMessages.some((m) => m.type === "subscribed"));

    await dbClient.query(
      `insert into core.outbox (name, version, actor_sub, actor_role, payload)
       values ('identity.user.registered', 1, $1, 'customer', $2::jsonb)`,
      [customerId, JSON.stringify({ user_id: customerId, role: "customer", locale: "ar" })]
    );

    await waitFor(() => wsMessages.some((m) => m.type === "event"));
    const pushed = wsMessages.find((m) => m.type === "event") as { event: { type: string; id: string } };
    expect(pushed.event.type).toBe("identity_welcome");

    const row = await dbClient.query("select type, identity_id from core.notifications where id = $1", [pushed.event.id]);
    expect(row.rows[0].type).toBe("identity_welcome");
    expect(row.rows[0].identity_id).toBe(customerId);

    const log = await dbClient.query(
      "select status from core.notification_log where notification_id = $1 and channel = 'in_app'",
      [pushed.event.id]
    );
    expect(log.rows[0].status).toBe("sent");

    ws.close();
  }, 15_000);
});
