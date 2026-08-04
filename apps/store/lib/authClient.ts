"use client";

// SF-03/SF-04 (S08): the storefront has no PC-01 session/cookie UI yet (out
// of scope for this session — only the cart/checkout API + a minimal client
// flow needed to prove it live) — a bearer token in localStorage is enough
// to carry a customer across the cart -> checkout -> confirmation pages.
// Client components run in the browser, on a different origin from the API
// (D-15 Vercel pivot: no Caddy same-origin proxy exists anymore) — every
// call must be an absolute URL built from NEXT_PUBLIC_API_URL (the
// browser-safe counterpart of lib/api.ts's server-only API_URL).
const TOKEN_KEY = "ps-store-token";
// EP-PC-004 hands back a 30-day rotating refresh token alongside the 1-hour
// access token. Storing only the access token (the original S08 shortcut) is
// what made "Add to cart" fail permanently: an hour after signing in the
// access token expired, requestContext.ts downgraded the request to
// anonymous, cart routes answered 401 INVALID_CREDENTIALS ("Incorrect email
// or password."), and nothing in the client could recover — getToken() still
// returned the dead token, so every page skipped its sign-in prompt and the
// customer was stuck until they manually cleared localStorage.
const REFRESH_KEY = "ps-store-refresh";

// Thrown when the session cannot be renewed. Callers show the sign-in form
// again rather than a raw API message — INVALID_CREDENTIALS reads as "wrong
// password", which is actively misleading for an expired session.
export const SESSION_EXPIRED = "SESSION_EXPIRED";
export const NOT_LOGGED_IN = "NOT_LOGGED_IN";
// This identity holds several roles; the storefront cannot pick one for them.
export const ROLE_SELECTION_REQUIRED = "ROLE_SELECTION_REQUIRED";
// Transport-level fetch failure (DNS, TLS, refused, blocked, offline).
export const NETWORK_ERROR = "NETWORK_UNREACHABLE";

// Every page that gates on `loggedIn` asks this instead of matching strings,
// so "the session is over, show the sign-in form" stays one decision.
export function isSessionEnded(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return message === SESSION_EXPIRED || message === NOT_LOGGED_IN;
}

function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("missing required env var NEXT_PUBLIC_API_URL");
  return `${base}${path}`;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

// Deliberately no exported setToken(): storing an access token without its
// refresh token is what created the unrecoverable state above, so the only
// way to open a session is login()/refresh, both of which write the pair.
function setSession(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

type AuthBody = {
  accessToken?: string;
  refreshToken?: string;
  // EP-PC-003 answers 200 with this instead of a token when the identity
  // holds more than one role grant and the request didn't name one. The
  // storefront has no role picker, so it says so plainly rather than
  // reporting a token it never received as some other kind of failure.
  status?: string;
  error?: { message?: string };
};

async function fetchOrNetworkError(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(NETWORK_ERROR);
  }
}

// A gateway failure (502, edge timeout) answers with HTML, not the API's
// JSON error envelope, so parsing has to be allowed to fail.
async function readJson(res: Response): Promise<AuthBody> {
  return res.json().catch(() => ({}));
}

export async function login(email: string, password: string): Promise<string> {
  const res = await fetchOrNetworkError(apiUrl("/api/v1/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(body.error?.message ?? `Login failed: ${res.status}`);
  if (body.status === "role_selection_required") throw new Error(ROLE_SELECTION_REQUIRED);
  if (!body.accessToken || !body.refreshToken) throw new Error(NETWORK_ERROR);
  setSession(body.accessToken, body.refreshToken);
  return body.accessToken;
}

// Refresh tokens rotate on use, and re-presenting a rotated one is treated as
// theft: routes/auth.ts revokes the entire family on TOKEN_REUSE_DETECTED. So
// concurrent 401s (the cart page alone fires four authed calls on mount) must
// NOT each start their own refresh — they share one in-flight attempt, or the
// second one would log the customer out of every device.
let refreshInFlight: Promise<string | null> | undefined;

// Returns null only when the server definitively rejects the refresh token
// (expired, revoked, reused). A transport failure propagates as NETWORK_ERROR
// instead: a tunnel or a dropped signal must not throw away a session that is
// still perfectly valid on the server.
async function runRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  const res = await fetchOrNetworkError(apiUrl("/api/v1/auth/refresh"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });
  if (!res.ok) return null;
  const body = await readJson(res);
  if (!body.accessToken || !body.refreshToken) return null;
  setSession(body.accessToken, body.refreshToken);
  return body.accessToken;
}

function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= runRefresh().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}

export async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) throw new Error(NOT_LOGGED_IN);

  const send = (bearer: string) =>
    fetchOrNetworkError(apiUrl(path), {
      ...init,
      headers: { ...init?.headers, authorization: `Bearer ${bearer}`, "content-type": "application/json" }
    });

  // Request bodies here are always plain JSON strings, so replaying `init` on
  // the retry is safe (a stream body would already be consumed).
  let res = await send(token);
  if (res.status === 401) {
    const renewed = await refreshAccessToken();
    if (!renewed) {
      clearToken();
      throw new Error(SESSION_EXPIRED);
    }
    res = await send(renewed);
    if (res.status === 401) {
      clearToken();
      throw new Error(SESSION_EXPIRED);
    }
  }

  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(body.error?.message ?? `${path} failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
