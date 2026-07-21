import type { PoolClient } from "pg";

// FR-PC05-001: "Any state change that emits an event writes the event row
// into core.outbox in the same DB transaction as the state change." Callers
// pass the SAME `client` their other writes in that transaction used —
// generic across every future EV-PC-### producer (06-integration-contracts
// §2 event catalog), not auth-specific.
export interface EventEnvelopeInput {
  name: string;
  version?: number;
  actorSub?: string | null;
  actorRole?: string | null;
  payload: Record<string, unknown>;
}

export async function publishEvent(client: PoolClient, event: EventEnvelopeInput): Promise<string> {
  const res = await client.query<{ event_id: string }>(
    `insert into core.outbox (name, version, actor_sub, actor_role, payload)
     values ($1, $2, $3, $4, $5) returning event_id`,
    [event.name, event.version ?? 1, event.actorSub ?? null, event.actorRole ?? null, JSON.stringify(event.payload)]
  );
  return res.rows[0]!.event_id;
}
