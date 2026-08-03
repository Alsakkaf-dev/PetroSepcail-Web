"use client";

// Same pattern as apps/store/lib/authClient.ts: no PC-01 session/cookie UI,
// a bearer token in localStorage carries the driver across screens. Every
// call is an absolute URL from NEXT_PUBLIC_API_URL — separate Vercel
// origins, no same-origin proxy (D-15).
const TOKEN_KEY = "ps-driver-token";

// The api service's own production origin. NEXT_PUBLIC_API_URL still wins
// whenever it is set — this only exists so that a Vercel project which is
// missing that variable degrades to "points at the real API" instead of
// "points at the developer's laptop", which is how driver.petrospecial.com
// broke: NEXT_PUBLIC_* is inlined at *build* time, apps/driver/.env.local is
// committed with the docker-compose value (http://localhost:4000) so `npm run
// dev` works out of the box, and @next/env only skips a .env file's value
// when the variable is already present in the build environment. With the
// variable unset on the project, the build happily baked localhost:4000 into
// the client bundle, the deploy went green, and every driver's login died in
// the browser as an opaque "Failed to fetch" (no server ever saw the request).
const FALLBACK_API_URL = "https://petro-sepcail-web-api-one.vercel.app";

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

// Exported for the unit test; not part of the module's public surface.
export function resolveApiBase(configured: string | undefined, pageOrigin: string | undefined): string {
  if (!configured) return FALLBACK_API_URL;
  // A loopback API base is correct only while the page itself is served from
  // loopback (local dev). Served from any real host it is unreachable by
  // definition — the browser would dial the *user's* machine — so treat it as
  // a missing value rather than forwarding a request that cannot succeed.
  if (pageOrigin && !isLoopback(pageOrigin) && isLoopback(new URL(configured).hostname)) {
    return FALLBACK_API_URL;
  }
  return configured;
}

function apiUrl(path: string): string {
  const base = resolveApiBase(
    process.env.NEXT_PUBLIC_API_URL,
    typeof window === "undefined" ? undefined : window.location.hostname
  );
  return `${base}${path}`;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

// fetch() rejects with a bare TypeError ("Failed to fetch") for every
// transport-level failure — DNS, TLS, refused connection, blocked mixed
// content, CORS preflight — and that string is what the login screen was
// putting in front of drivers. It says nothing they can act on and, worse,
// reads like a wrong password. Collapse it into one code the UI can
// translate; every non-network error keeps its own message.
const NETWORK_ERROR = "NETWORK_UNREACHABLE";

async function fetchOrNetworkError(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(NETWORK_ERROR);
  }
}

// A gateway/proxy failure (Vercel 502, edge timeout) answers with HTML, not
// the API's JSON error envelope, so parsing has to be allowed to fail.
type ErrorEnvelope = { error?: { message?: string }; accessToken?: string };

async function readJson(res: Response): Promise<ErrorEnvelope> {
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
  // A 2xx whose body didn't parse (an intercepting proxy, a cached HTML
  // page) would otherwise store `undefined` as the token and push the driver
  // into the app, where the first authed call fails instead.
  if (!body.accessToken) throw new Error(NETWORK_ERROR);
  setToken(body.accessToken);
  return body.accessToken;
}

export async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");
  const res = await fetchOrNetworkError(apiUrl(path), {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}`, "content-type": "application/json" }
  });
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(body.error?.message ?? `${path} failed: ${res.status}`);
  }
  if (res.status === 202 || res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
