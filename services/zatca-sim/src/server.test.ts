import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

describe("zatca-sim /health", () => {
  it("returns ok status", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "zatca-sim" });
  });
});
