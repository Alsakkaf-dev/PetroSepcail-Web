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
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${token}`, "content-type": "application/json" }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? `${path} failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
