import { pingDb } from "../db.js";

// EP-PC-061 · GET /ready · public -> 200 {db,storage,realtime} or 503
// (FR-PC04-005). Real reachability checks, not hardcoded true — storage
// (MinIO) and realtime are plain HTTP probes since neither has a client
// library wired yet (PC-09 media is S05, the realtime service itself is
// S04); MINIO_HEALTH_URL/REALTIME_URL are env-driven (D-13 parity), never
// hardcoded hosts.
export interface ReadinessResult {
  db: boolean;
  storage: boolean;
  realtime: boolean;
}

async function probeHttp(url: string, timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkReadiness(): Promise<ReadinessResult> {
  const [db, storage, realtime] = await Promise.all([
    pingDb(),
    probeHttp(process.env.MINIO_HEALTH_URL ?? ""),
    probeHttp(`${process.env.REALTIME_URL ?? ""}/health`)
  ]);
  return { db, storage, realtime };
}
