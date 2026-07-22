import os from "node:os";
import pino, { type LoggerOptions, type Logger } from "pino";
import { maskPii } from "./piiMask.js";

// PC-10 (FR-PC10-001/TC-PC10-001). Two complementary layers:
// 1. `redact` — pino's structural redaction for known secret/PII object
//    paths (auth headers, password/token fields), in case a future caller
//    ever logs a raw request/body object.
// 2. `hooks.logMethod` — a content-based scrub (maskPii) applied to every
//    string in every log call, so PII embedded in a free-text message (e.g.
//    "login failed for jdoe@example.com") is masked even though no `redact`
//    path could ever describe it.
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "*.totpSecret",
  "*.token",
  "*.accessToken",
  "*.refreshToken"
];

const MAX_SCRUB_DEPTH = 6;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH) return value;
  if (typeof value === "string") return maskPii(value);
  if (value instanceof Error) {
    return { type: value.name, message: maskPii(value.message), stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, depth + 1);
    return out;
  }
  return value;
}

export function buildLoggerOptions(service: string): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    base: { pid: process.pid, hostname: os.hostname(), service },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    hooks: {
      logMethod(inputArgs, method) {
        const scrubbed = inputArgs.map((arg) => scrub(arg)) as Parameters<typeof method>;
        return method.apply(this, scrubbed);
      }
    }
  };
}

export function createLogger(service: string): Logger {
  return pino(buildLoggerOptions(service));
}
