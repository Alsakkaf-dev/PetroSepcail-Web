import { describe, expect, it } from "vitest";
import { handleRequest, type MinimalResponse } from "./health.js";

function mockResponse(): MinimalResponse & { chunks: string[]; status?: number } {
  const chunks: string[] = [];
  return {
    chunks,
    writeHead(statusCode) {
      this.status = statusCode;
    },
    end(chunk) {
      if (chunk) chunks.push(chunk);
    }
  };
}

describe("workers /health", () => {
  it("returns ok status", () => {
    const res = mockResponse();
    handleRequest({ url: "/health" }, res);
    expect(res.status).toBe(200);
    expect(res.chunks).toHaveLength(1);
    expect(JSON.parse(res.chunks[0] ?? "")).toEqual({ status: "ok", service: "workers" });
  });
});
