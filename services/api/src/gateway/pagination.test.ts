import { describe, expect, it } from "vitest";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "./pagination.js";

describe("parsePagination", () => {
  it("defaults to limit=20 and no cursor", () => {
    expect(parsePagination({})).toEqual({ cursor: undefined, limit: 20 });
  });

  it("caps limit at 100 (FR-PC04-001)", () => {
    expect(parsePagination({ limit: "500" }).limit).toBe(100);
  });

  it("passes through a valid cursor string", () => {
    expect(parsePagination({ cursor: "abc123" }).cursor).toBe("abc123");
  });

  it("rejects a non-integer limit", () => {
    expect(() => parsePagination({ limit: "not-a-number" })).toThrow();
  });

  it("rejects a zero/negative limit", () => {
    expect(() => parsePagination({ limit: "0" })).toThrow();
    expect(() => parsePagination({ limit: "-5" })).toThrow();
  });
});

describe("cursor encode/decode", () => {
  it("round-trips arbitrary sort-key data", () => {
    const original = { createdAt: "2026-07-22T00:00:00.000Z", id: "abc-123" };
    expect(decodeCursor(encodeCursor(original))).toEqual(original);
  });

  it("rejects a malformed cursor instead of crashing", () => {
    expect(() => decodeCursor("not-valid-base64url-json")).toThrow();
  });
});

describe("buildPage", () => {
  it("returns the {items, nextCursor} shape (05-api-specification §9)", () => {
    expect(buildPage([1, 2, 3], "next-cursor")).toEqual({ items: [1, 2, 3], nextCursor: "next-cursor" });
    expect(buildPage([], null)).toEqual({ items: [], nextCursor: null });
  });
});
