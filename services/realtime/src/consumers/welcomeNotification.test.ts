import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearConsumers, listConsumers, runConsumers } from "./framework.js";
import { registerWelcomeNotificationConsumer } from "./welcomeNotification.js";
import type { EventEnvelope } from "../events.js";

const query = vi.fn();
const withServiceRoleTransaction = vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query }));

vi.mock("../db.js", () => ({
  withServiceRoleTransaction: (...args: unknown[]) => withServiceRoleTransaction(args[0] as never)
}));

function envelope(overrides: Partial<EventEnvelope>): EventEnvelope {
  return {
    eventId: "11111111-1111-1111-1111-111111111111",
    name: "identity.user.registered",
    version: 1,
    occurredAt: new Date().toISOString(),
    actor: { sub: null, role: null },
    payload: {},
    ...overrides
  };
}

describe("registerWelcomeNotificationConsumer", () => {
  beforeEach(() => {
    clearConsumers();
    query.mockReset();
    withServiceRoleTransaction.mockClear();
    // "already processed?" check, then the insert, then the notification_log insert.
    query.mockResolvedValueOnce({ rowCount: 0 });
    query.mockResolvedValueOnce({ rows: [{ id: "n-1", created_at: new Date() }] });
    query.mockResolvedValueOnce({});
    query.mockResolvedValueOnce({}); // processed_events insert (framework.ts)
  });

  // Regression for a real bug: runConsumers() (framework.ts) fires every
  // registered consumer against every outbox event with no name filter.
  // Before this guard existed, any non-"identity.user.registered" event
  // (e.g. platform.config.changed) crashed here on a null payload.user_id
  // NOT NULL violation, which permanently jammed the whole outbox — the
  // dispatcher only ever retries the same oldest undispatched row.
  it("ignores events that are not identity.user.registered", async () => {
    const broadcastToChannel = vi.fn();
    registerWelcomeNotificationConsumer(broadcastToChannel);
    expect(listConsumers()).toEqual(["pc06.welcome-notification"]);

    const client = { query } as never;
    await runConsumers(client, envelope({ name: "platform.config.changed", payload: { key: "x", old: 1, new: 2 } }));

    expect(withServiceRoleTransaction).not.toHaveBeenCalled();
    expect(broadcastToChannel).not.toHaveBeenCalled();
    // Still marked processed for this consumer (idempotency ledger), just a no-op.
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into core.processed_events"),
      expect.arrayContaining(["pc06.welcome-notification"])
    );
  });

  it("inserts a welcome notification and broadcasts it for identity.user.registered", async () => {
    const broadcastToChannel = vi.fn();
    registerWelcomeNotificationConsumer(broadcastToChannel);

    const client = { query } as never;
    await runConsumers(client, envelope({ payload: { user_id: "u-1", role: "customer", locale: "ar" } }));

    expect(withServiceRoleTransaction).toHaveBeenCalledTimes(1);
    expect(broadcastToChannel).toHaveBeenCalledWith("identity:u-1:notifications", expect.objectContaining({ type: "identity_welcome" }));
  });
});
