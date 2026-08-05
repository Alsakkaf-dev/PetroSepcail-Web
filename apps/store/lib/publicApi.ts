"use client";

// The browser-side counterpart of lib/api.ts, for the public catalogue reads
// a Client Component makes on its own: search suggestions, and anything else
// that needs no bearer token.
//
// lib/api.ts runs in a Server Component and reads API_URL; lib/authClient.ts
// runs in the browser but requires a session. Neither fits an
// as-you-type suggestion box on a page a signed-out visitor can use, which is
// what this is for. Same rule as both of them: no fallback literal — a
// missing env var fails loudly rather than quietly resolving to a host that
// does not exist (D-13/parity-grep).
function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("missing required env var NEXT_PUBLIC_API_URL");
  return `${base}${path}`;
}

export async function publicGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(apiUrl(path), { signal });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
