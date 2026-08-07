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

/** The unauthenticated writes: register, verify email, request and confirm a
 * password reset. None of them can go through `authedFetch` — they exist
 * precisely because there is no session yet.
 *
 * `accept-language` goes with every one of them so a rejection comes back in
 * the reader's language; `messageFor()` maps the registry code either way,
 * but a validation detail the registry has no code for is only ever readable
 * if the server wrote it in the right language. */
export async function publicPost<T>(path: string, body: unknown, locale: "ar" | "en"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": locale },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("NETWORK_UNREACHABLE");
  }
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(parsed.error?.message ?? `${path} failed: ${res.status}`);
  }
  // 202 (password-reset request) and 204 carry no body.
  if (res.status === 202 || res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
