import { describe, expect, it } from "vitest";
import { createMetrics } from "./metrics";

describe("TC-PC10-004 Prometheus metrics", () => {
  it("registers a default-labels service name on every metric", async () => {
    const { registry } = createMetrics("api");
    const text = await registry.metrics();
    expect(text).toContain('service="api"');
  });

  it("exposes http request latency as a histogram", async () => {
    const { registry, httpRequestDuration } = createMetrics("api");
    httpRequestDuration.observe({ method: "GET", route: "/health", status_code: "200" }, 0.02);
    const text = await registry.metrics();
    expect(text).toContain("http_request_duration_seconds");
    expect(text).toContain('method="GET"');
  });

  it("exposes an http error counter", async () => {
    const { registry, httpErrorsTotal } = createMetrics("api");
    httpErrorsTotal.inc({ method: "GET", route: "/health", status_code: "500" });
    const text = await registry.metrics();
    expect(text).toContain('http_errors_total{method="GET",route="/health",status_code="500",service="api"} 1');
  });

  it("exposes event-dispatch lag as a histogram", async () => {
    const { registry, eventDispatchLag } = createMetrics("realtime");
    eventDispatchLag.observe(1.5);
    const text = await registry.metrics();
    expect(text).toContain("event_dispatch_lag_seconds");
  });

  it("exposes an auth-failures counter keyed by reason", async () => {
    const { registry, authFailuresTotal } = createMetrics("api");
    authFailuresTotal.inc({ reason: "INVALID_CREDENTIALS" });
    const text = await registry.metrics();
    expect(text).toContain('reason="INVALID_CREDENTIALS"');
  });

  it("includes Node process default metrics (memory, event loop)", async () => {
    const { registry } = createMetrics("api");
    const text = await registry.metrics();
    expect(text).toContain("process_cpu_user_seconds_total");
  });
});
