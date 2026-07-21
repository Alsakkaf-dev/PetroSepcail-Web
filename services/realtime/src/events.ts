// 06-integration-contracts.md §1 event envelope, as read back from
// core.outbox (db/migrations/0004, S01 — column names differ slightly:
// actor_sub/actor_role split instead of a nested actor object).
export interface EventEnvelope {
  eventId: string;
  name: string;
  version: number;
  occurredAt: string;
  actor: { sub: string | null; role: string | null };
  payload: Record<string, unknown>;
}
