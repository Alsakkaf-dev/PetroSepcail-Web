"use client";

// AC-M5-0 scaffold delta groundwork: same pattern apps/driver/lib/authClient.ts
// already established (S11) — persists the bearer token in localStorage so a
// session survives across the console's separate pages, rather than each
// page re-deriving its own throwaway login form the way catalog/users pages
// (S07/S09) did before this file existed. Those two pages are left as-is
// (not retrofitted here — out of scope for this pass); every new admin page
// uses this shared client.
const TOKEN_KEY = "ps-admin-token";

function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("missing required env var NEXT_PUBLIC_API_URL");
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

// EP-PC-005 · POST /auth/logout — no app ever called this; "sign out"
// everywhere only cleared the local token, so the refresh-token family
// stayed valid server-side (30-day TTL) until it happened to expire on its
// own. This app never persists its own refresh token, so there is nothing
// to scope the revocation to — the server revokes every active family for
// this identity+role, which is the correct behaviour for the only session
// this client itself knows about. Best-effort: a dropped network request
// must not block clearing the local session the user asked to end.
export async function logout(): Promise<void> {
  const token = getToken();
  clearToken();
  if (!token) return;
  try {
    await fetch(apiUrl("/api/v1/auth/logout"), { method: "POST", headers: { authorization: `Bearer ${token}` } });
  } catch {
    // Local sign-out already happened; the server-side session will still
    // fall away on its own TTL.
  }
}

export async function login(email: string, password: string, totp?: string): Promise<string> {
  const res = await fetch(apiUrl("/api/v1/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(totp ? { email, password, totp } : { email, password })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? "Login failed");
  setToken(body.accessToken);
  return body.accessToken;
}

export const SESSION_EXPIRED = "SESSION_EXPIRED";

export async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");
  // Only declare a JSON body when there is one. On a bodyless request the
  // header makes Fastify parse zero bytes and throw "Body cannot be empty
  // when content-type is set to 'application/json'" — a 500 raised before
  // the handler ever runs.
  const hasBody = init?.body !== undefined && init?.body !== null;
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...init?.headers,
      authorization: `Bearer ${token}`,
      ...(hasBody ? { "content-type": "application/json" } : {})
    }
  });
  if (res.status === 401) {
    // The console has no /login route — LoginGate wraps every page and
    // decides what to show from getToken() at mount. This app has no
    // offline write queue to protect (unlike apps/driver), so there is no
    // reason to defer the reload: a stale token dead-ended every screen
    // behind a "Retry" that resent the same dead credential forever, reading
    // as "Incorrect email or password" for a session that had simply timed
    // out. The reload re-mounts LoginGate, which shows sign-in immediately.
    clearToken();
    if (typeof window !== "undefined") window.location.reload();
    throw new Error(SESSION_EXPIRED);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? `${path} failed: ${res.status}`);
  }
  if (res.status === 202 || res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
