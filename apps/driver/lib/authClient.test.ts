// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authedFetch, resolveApiBase } from "./authClient";

// Regression guard for the driver.petrospecial.com login outage: the Vercel
// project had no NEXT_PUBLIC_API_URL, so the committed dev value in
// apps/driver/.env.local (http://localhost:4000) was inlined into the
// production client bundle and every login failed in the browser as
// "Failed to fetch" — no request ever left the driver's phone.
describe("resolveApiBase", () => {
  const PROD_FALLBACK = "https://petro-sepcail-web-api-one.vercel.app";

  it("uses the configured base when it is set", () => {
    expect(resolveApiBase("https://api.example.com", "driver.petrospecial.com")).toBe("https://api.example.com");
  });

  it("falls back when the variable is missing from the build", () => {
    expect(resolveApiBase(undefined, "driver.petrospecial.com")).toBe(PROD_FALLBACK);
  });

  it("falls back when a loopback base was baked into a bundle served from a real host", () => {
    expect(resolveApiBase("http://localhost:4000", "driver.petrospecial.com")).toBe(PROD_FALLBACK);
    expect(resolveApiBase("http://127.0.0.1:4000", "driver.petrospecial.com")).toBe(PROD_FALLBACK);
  });

  it("keeps a loopback base during local development", () => {
    expect(resolveApiBase("http://localhost:4000", "localhost")).toBe("http://localhost:4000");
    expect(resolveApiBase("http://localhost:4000", "127.0.0.1")).toBe("http://localhost:4000");
  });

  it("keeps the configured base when rendering on the server, where there is no page origin", () => {
    expect(resolveApiBase("http://localhost:4000", undefined)).toBe("http://localhost:4000");
  });
});

// Fastify answers "Body cannot be empty when content-type is set to
// 'application/json'" with a 500 before the handler runs, so a bodyless
// request must not claim to carry JSON. Every driver task transition
// (accept/decline, at-pickup, picked-up, en-route, arrived, OTP regenerate,
// return-to-hub) posts without a body and was hitting exactly that.
describe("authedFetch content-type", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000";
    window.localStorage.setItem("ps-driver-token", "access-1");
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  function ok(): Response {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  it("omits the JSON content-type on a request with no body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());

    await authedFetch("/api/v1/driver/tasks/t1/accept", { method: "POST" });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
    expect(headers.authorization).toBe("Bearer access-1");
  });

  it("still declares the JSON content-type when a body is sent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());

    await authedFetch("/api/v1/driver/shifts", { method: "POST", body: JSON.stringify({ vanPlate: "ABC 1234" }) });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
  });
});
