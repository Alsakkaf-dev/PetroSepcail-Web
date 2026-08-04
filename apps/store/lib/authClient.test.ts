// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authedFetch, clearToken, isSessionEnded, login, NETWORK_ERROR, SESSION_EXPIRED } from "./authClient";

// Regression guard for the "Add to cart -> Failed" outage: the storefront kept
// only the 1-hour access token and threw away the 30-day refresh token, so an
// hour after signing in every authed call answered 401 INVALID_CREDENTIALS and
// nothing in the client could recover — getToken() still returned the dead
// token, so pages skipped their sign-in prompt and the customer was stuck.
const API = "http://localhost:4000";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function unauthorized(): Response {
  return jsonResponse(401, { error: { code: "INVALID_CREDENTIALS", message: "Incorrect email or password." } });
}

describe("store authClient session handling", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = API;
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the refresh token from login so the session can outlive the access token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, { accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 3600, role: "customer" })
    );

    await login("customer@example.com", "pw");

    expect(window.localStorage.getItem("ps-store-token")).toBe("access-1");
    expect(window.localStorage.getItem("ps-store-refresh")).toBe("refresh-1");
  });

  it("refreshes and retries once when the access token has expired", async () => {
    window.localStorage.setItem("ps-store-token", "expired");
    window.localStorage.setItem("ps-store-refresh", "refresh-1");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 3600 }))
      .mockResolvedValueOnce(jsonResponse(201, { line: { lineId: "l1" } }));

    const result = await authedFetch<{ line: { lineId: string } }>("/api/v1/cart/lines", { method: "POST" });

    expect(result.line.lineId).toBe("l1");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${API}/api/v1/auth/refresh`);
    // The retry carries the new token, and the rotated refresh token is kept.
    const retryHeaders = fetchMock.mock.calls[2]?.[1]?.headers as Record<string, string>;
    expect(retryHeaders.authorization).toBe("Bearer access-2");
    expect(window.localStorage.getItem("ps-store-refresh")).toBe("refresh-2");
  });

  it("signs the customer out when the refresh token is rejected", async () => {
    window.localStorage.setItem("ps-store-token", "expired");
    window.localStorage.setItem("ps-store-refresh", "revoked");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "TOKEN_REUSE_DETECTED", message: "no" } }));

    await expect(authedFetch("/api/v1/cart")).rejects.toThrow(SESSION_EXPIRED);
    // Both tokens gone -> pages fall back to the sign-in form instead of
    // dead-ending on a "wrong password" message for an expired session.
    expect(window.localStorage.getItem("ps-store-token")).toBeNull();
    expect(window.localStorage.getItem("ps-store-refresh")).toBeNull();
  });

  it("signs out an old session that predates refresh-token storage", async () => {
    window.localStorage.setItem("ps-store-token", "stale-from-before-the-fix");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(unauthorized());

    await expect(authedFetch("/api/v1/cart")).rejects.toThrow(SESSION_EXPIRED);
    expect(window.localStorage.getItem("ps-store-token")).toBeNull();
  });

  it("refreshes only once for concurrent 401s, since re-presenting a rotated token revokes the family", async () => {
    window.localStorage.setItem("ps-store-token", "expired");
    window.localStorage.setItem("ps-store-refresh", "refresh-1");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/auth/refresh")) {
        return jsonResponse(200, { accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 3600 });
      }
      return window.localStorage.getItem("ps-store-token") === "access-2" ? jsonResponse(200, { ok: true }) : unauthorized();
    });

    await Promise.all([authedFetch("/api/v1/cart"), authedFetch("/api/v1/me"), authedFetch("/api/v1/orders")]);

    const refreshCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/api/v1/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("does not discard a valid session because the network dropped mid-refresh", async () => {
    window.localStorage.setItem("ps-store-token", "expired");
    window.localStorage.setItem("ps-store-refresh", "refresh-1");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(unauthorized())
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(authedFetch("/api/v1/cart")).rejects.toThrow(NETWORK_ERROR);
    expect(window.localStorage.getItem("ps-store-refresh")).toBe("refresh-1");
  });

  it("reports a transport failure as a network error, not a wrong password", async () => {
    window.localStorage.setItem("ps-store-token", "access-1");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(authedFetch("/api/v1/cart")).rejects.toThrow(NETWORK_ERROR);
  });

  it("treats both end-of-session codes as a prompt to sign in again", () => {
    expect(isSessionEnded(new Error(SESSION_EXPIRED))).toBe(true);
    expect(isSessionEnded(new Error("NOT_LOGGED_IN"))).toBe(true);
    expect(isSessionEnded(new Error("Out of stock"))).toBe(false);
  });

  it("clears both halves of the session on sign-out", () => {
    window.localStorage.setItem("ps-store-token", "a");
    window.localStorage.setItem("ps-store-refresh", "b");
    clearToken();
    expect(window.localStorage.getItem("ps-store-token")).toBeNull();
    expect(window.localStorage.getItem("ps-store-refresh")).toBeNull();
  });
});
