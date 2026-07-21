import type { PoolClient } from "pg";
import type { EventEnvelope } from "../events.js";

// PC-EV-4 / NFR-PC-009: every consumer dedupes on event_id, per-consumer
// (core.processed_events, db/migrations/0012, S04). 03-sdd.md §5: "K->>DB:
// SELECT 1 FROM processed WHERE event_id? / alt already processed -> ack
// (no-op) / else -> do work + INSERT processed(event_id)".
export type ConsumerHandler = (envelope: EventEnvelope) => Promise<void>;

const registry = new Map<string, ConsumerHandler>();

export function registerConsumer(name: string, handler: ConsumerHandler): void {
  registry.set(name, handler);
}

// Exposed for tests / introspection — not used by the dispatcher directly.
export function listConsumers(): string[] {
  return [...registry.keys()];
}

export function clearConsumers(): void {
  registry.clear();
}

// Runs every registered consumer against one event, skipping any that have
// already processed this exact event_id. `client` must be inside the same
// transaction the dispatcher uses to mark the outbox row dispatched, so a
// consumer failure rolls back its own processed-row insert too (the event
// stays undispatched and is retried on the next drain cycle).
export async function runConsumers(client: PoolClient, envelope: EventEnvelope): Promise<void> {
  for (const [name, handler] of registry) {
    const already = await client.query("select 1 from core.processed_events where consumer_name = $1 and event_id = $2", [
      name,
      envelope.eventId
    ]);
    if (already.rowCount! > 0) continue;

    await handler(envelope);
    await client.query("insert into core.processed_events (consumer_name, event_id) values ($1, $2)", [
      name,
      envelope.eventId
    ]);
  }
}
