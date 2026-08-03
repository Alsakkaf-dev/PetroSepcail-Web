import { describe, expect, it } from "vitest";
import { resolveApiBase } from "./authClient";

// Regression guard for the driver.petrospecial.com login outage: the Vercel
// project had no NEXT_PUBLIC_API_URL, so the committed dev value in
// apps/driver/.env.local (http://localhost:4000) was inlined into the
// production client bundle and every login failed in the browser as
// "Failed to fetch" — no request ever left the driver's phone.
describe("resolveApiBase", () => {
  const PROD_FALLBACK = "https://petro-sepcail-web-api-one.vercel.app";

  it("uses the configured base when it is set", () => {
    expect(resolveApiBase("https://api.example.com", "driver.petrospecial.com")).toBe("https://api.example.com");
  });

  it("falls back when the variable is missing from the build", () => {
    expect(resolveApiBase(undefined, "driver.petrospecial.com")).toBe(PROD_FALLBACK);
  });

  it("falls back when a loopback base was baked into a bundle served from a real host", () => {
    expect(resolveApiBase("http://localhost:4000", "driver.petrospecial.com")).toBe(PROD_FALLBACK);
    expect(resolveApiBase("http://127.0.0.1:4000", "driver.petrospecial.com")).toBe(PROD_FALLBACK);
  });

  it("keeps a loopback base during local development", () => {
    expect(resolveApiBase("http://localhost:4000", "localhost")).toBe("http://localhost:4000");
    expect(resolveApiBase("http://localhost:4000", "127.0.0.1")).toBe("http://localhost:4000");
  });

  it("keeps the configured base when rendering on the server, where there is no page origin", () => {
    expect(resolveApiBase("http://localhost:4000", undefined)).toBe("http://localhost:4000");
  });
});
