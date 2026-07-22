import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

// TC-PC10-004: the 4 signals the SDD names explicitly — HTTP latency, error
// rate, event-dispatch lag, auth failures. Mirrors logger.ts's shape:
// one factory per service, called once at process startup.
export interface Metrics {
  registry: Registry;
  httpRequestDuration: Histogram<"method" | "route" | "status_code">;
  httpErrorsTotal: Counter<"method" | "route" | "status_code">;
  eventDispatchLag: Histogram<string>;
  authFailuresTotal: Counter<"reason">;
}

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const DISPATCH_LAG_BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 30, 60];

export function createMetrics(service: string): Metrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });

  const httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request latency in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: LATENCY_BUCKETS,
    registers: [registry]
  });

  const httpErrorsTotal = new Counter({
    name: "http_errors_total",
    help: "Total HTTP responses with status >= 500",
    labelNames: ["method", "route", "status_code"],
    registers: [registry]
  });

  const eventDispatchLag = new Histogram({
    name: "event_dispatch_lag_seconds",
    help: "Time between an outbox event occurring and being dispatched",
    buckets: DISPATCH_LAG_BUCKETS,
    registers: [registry]
  });

  const authFailuresTotal = new Counter({
    name: "auth_failures_total",
    help: "Total authentication failures",
    labelNames: ["reason"],
    registers: [registry]
  });

  return { registry, httpRequestDuration, httpErrorsTotal, eventDispatchLag, authFailuresTotal };
}
