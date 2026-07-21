import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

describe("api gateway", () => {
  it("GET /health returns ok status", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "api" });
  });

  it("GET /api/v1/health returns ok status (EP-PC-060)", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("attaches an X-Request-Id to every response (FR-PC04-002)", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("echoes a caller-supplied X-Request-Id instead of generating a new one", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "caller-supplied-id" }
    });
    expect(res.headers["x-request-id"]).toBe("caller-supplied-id");
  });

  it("GET /api/v1/ready returns 503 with per-dependency detail when nothing is reachable (no docker-compose stack in this test)", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ db: false, storage: false, realtime: false });
  });
});
