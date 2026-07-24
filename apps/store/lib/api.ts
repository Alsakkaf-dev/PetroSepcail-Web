// Server Components run in the `store` Vercel deployment and call the
// separately-deployed `petro-sepcail-web-api` project over public HTTPS
// (D-15 pivot — no shared Docker network anymore); API_URL is that
// project's real reachable URL. No fallback literal (D-13/parity-grep):
// a missing env var must fail loudly, not silently resolve to localhost.
function apiUrl(path: string): string {
  const base = process.env.API_URL;
  if (!base) throw new Error("missing required env var API_URL");
  return `${base}${path}`;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 404) return null as T;
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
