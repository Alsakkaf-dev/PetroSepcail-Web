"use client";

// Same pattern as apps/driver/lib/authClient.ts: no PC-01 session/cookie UI,
// a bearer token in localStorage carries the supplier across screens. Every
// call is an absolute URL from NEXT_PUBLIC_API_URL — separate Vercel
// origins, no same-origin proxy (D-15).
const TOKEN_KEY = "ps-supplier-token";

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

export async function login(email: string, password: string): Promise<string> {
  const res = await fetch(apiUrl("/api/v1/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? "Login failed");
  setToken(body.accessToken);
  return body.accessToken;
}

export async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");
  // Only declare a JSON body when there is one. On a bodyless request the
  // header makes Fastify parse zero bytes and throw "Body cannot be empty
  // when content-type is set to 'application/json'" — a 500 raised before
  // the handler ever runs (supplier cart removal, order cancel, template
  // delete all hit it).
  const hasBody = init?.body !== undefined && init?.body !== null;
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...init?.headers,
      authorization: `Bearer ${token}`,
      ...(hasBody ? { "content-type": "application/json" } : {})
    }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? `${path} failed: ${res.status}`);
  }
  if (res.status === 202 || res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
