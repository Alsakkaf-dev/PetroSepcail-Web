import { describe, expect, it } from "vitest";
import { computePdplDueAt, findOpenIncident, openIncident, resolveIncident, type Queryable } from "./incidents.js";

function fakeDb(rows: Array<Record<string, unknown>>): Queryable & { calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    }
  };
}

describe("computePdplDueAt", () => {
  it("returns opened_at + 72h when touchesData is true", () => {
    const openedAt = new Date("2026-01-01T00:00:00.000Z");
    const dueAt = computePdplDueAt(openedAt, true);
    expect(dueAt?.toISOString()).toBe("2026-01-04T00:00:00.000Z");
  });

  it("returns null when touchesData is false", () => {
    expect(computePdplDueAt(new Date(), false)).toBeNull();
  });
});

describe("openIncident", () => {
  it("inserts a row and sets pdpl_assessment_due_at when touchesData is true", async () => {
    const db = fakeDb([{ id: 42 }]);
    const id = await openIncident(db, { severity: "S1", service: "api", message: "ready check failing", touchesData: true });
    expect(id).toBe(42);
    expect(db.calls[0]!.sql).toContain("insert into ops.incidents");
    const params = db.calls[0]!.params!;
    expect(params[0]).toBe("S1");
    expect(params[1]).toBe("api");
    expect(params[3]).toBe(true);
    expect(params[5]).toBeInstanceOf(Date);
  });

  it("defaults touchesData to false and sets pdpl_assessment_due_at to null", async () => {
    const db = fakeDb([{ id: 7 }]);
    await openIncident(db, { severity: "S2", service: "realtime", message: "degraded" });
    const params = db.calls[0]!.params!;
    expect(params[3]).toBe(false);
    expect(params[5]).toBeNull();
  });
});

describe("resolveIncident", () => {
  it("updates resolved_at for the given incident id only if still open", async () => {
    const db = fakeDb([]);
    await resolveIncident(db, 42);
    expect(db.calls[0]!.sql).toContain("resolved_at = now()");
    expect(db.calls[0]!.params).toEqual([42]);
  });
});

describe("findOpenIncident", () => {
  it("returns the most recent unresolved incident id for a service", async () => {
    const db = fakeDb([{ id: 5 }]);
    const found = await findOpenIncident(db, "api");
    expect(found).toEqual({ id: 5 });
  });

  it("returns null when no open incident exists", async () => {
    const db = fakeDb([]);
    const found = await findOpenIncident(db, "api");
    expect(found).toBeNull();
  });
});
