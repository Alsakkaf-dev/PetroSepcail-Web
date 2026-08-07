"use client";

// The one endpoint in this portal that takes no bearer token: the public
// pickup-point directory (EP-SP-012). `lib/authClient.ts`'s authedFetch
// cannot serve it — a signed-out visitor has no token and the whole point of
// the directory is that they do not need one.
//
// Same rule as every other API helper on the platform: no fallback literal.
// A missing env var fails loudly rather than quietly resolving to a host that
// does not exist (D-13/parity-grep).
function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("missing required env var NEXT_PUBLIC_API_URL");
  return `${base}${path}`;
}

export async function publicGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { signal });
  } catch {
    throw new Error("NETWORK_UNREACHABLE");
  }
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(parsed.error?.message ?? `${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}
