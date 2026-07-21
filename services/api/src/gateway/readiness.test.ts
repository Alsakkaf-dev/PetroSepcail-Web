import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pingDb } from "../db.js";
import { checkReadiness } from "./readiness.js";

vi.mock("../db.js", () => ({ pingDb: vi.fn() }));

describe("checkReadiness", () => {
  let okServer: Server;
  let okUrl: string;
  let failServer: Server;
  let failUrl: string;

  beforeAll(async () => {
    okServer = createServer((_req, res) => res.writeHead(200).end("ok"));
    await new Promise<void>((resolve) => okServer.listen(0, "127.0.0.1", resolve));
    const okAddr = okServer.address();
    okUrl = `http://127.0.0.1:${typeof okAddr === "object" && okAddr ? okAddr.port : 0}`;

    failServer = createServer((_req, res) => res.writeHead(500).end("nope"));
    await new Promise<void>((resolve) => failServer.listen(0, "127.0.0.1", resolve));
    const failAddr = failServer.address();
    failUrl = `http://127.0.0.1:${typeof failAddr === "object" && failAddr ? failAddr.port : 0}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => okServer.close(resolve));
    await new Promise((resolve) => failServer.close(resolve));
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.MINIO_HEALTH_URL;
    delete process.env.REALTIME_URL;
  });

  it("reports all true when db/storage/realtime are all reachable", async () => {
    vi.mocked(pingDb).mockResolvedValue(true);
    process.env.MINIO_HEALTH_URL = okUrl;
    process.env.REALTIME_URL = okUrl;

    expect(await checkReadiness()).toEqual({ db: true, storage: true, realtime: true });
  });

  it("reports db:false when the DB check fails, independent of the others", async () => {
    vi.mocked(pingDb).mockResolvedValue(false);
    process.env.MINIO_HEALTH_URL = okUrl;
    process.env.REALTIME_URL = okUrl;

    expect(await checkReadiness()).toEqual({ db: false, storage: true, realtime: true });
  });

  it("reports storage:false on a non-2xx response", async () => {
    vi.mocked(pingDb).mockResolvedValue(true);
    process.env.MINIO_HEALTH_URL = failUrl;
    process.env.REALTIME_URL = okUrl;

    expect(await checkReadiness()).toEqual({ db: true, storage: false, realtime: true });
  });

  it("reports realtime:false when the service is unreachable (connection refused)", async () => {
    vi.mocked(pingDb).mockResolvedValue(true);
    process.env.MINIO_HEALTH_URL = okUrl;
    process.env.REALTIME_URL = "http://127.0.0.1:1"; // nothing listens on port 1

    expect(await checkReadiness()).toEqual({ db: true, storage: true, realtime: false });
  });
});
