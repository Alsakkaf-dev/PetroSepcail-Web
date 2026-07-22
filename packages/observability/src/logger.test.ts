import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { buildLoggerOptions } from "./logger";

function captureLogger(service: string) {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, callback) {
      lines.push(chunk.toString());
      callback();
    }
  });
  const logger = pino(buildLoggerOptions(service), sink);
  return { logger, lines: () => lines.map((l) => JSON.parse(l)) };
}

describe("TC-PC10-001 structured JSON PII-masked logging", () => {
  it("emits one JSON object per line with a service field", () => {
    const { logger, lines } = captureLogger("api");
    logger.info("hello");
    const [record] = lines();
    expect(record.service).toBe("api");
    expect(record.msg).toBe("hello");
    expect(typeof record.time).toBe("number");
  });

  it("masks an email embedded in a free-text message", () => {
    const { logger, lines } = captureLogger("api");
    logger.warn("login failed for jdoe@example.com");
    const [record] = lines();
    expect(record.msg).toBe("login failed for j***@example.com");
    expect(record.msg).not.toContain("jdoe@example.com");
  });

  it("masks a Saudi phone number embedded in a free-text message", () => {
    const { logger, lines } = captureLogger("api");
    logger.warn("otp sent to +966512345678");
    const [record] = lines();
    expect(record.msg).not.toContain("512345678");
  });

  it("masks PII inside a logged object's string fields, not just the message", () => {
    const { logger, lines } = captureLogger("api");
    logger.info({ actorEmail: "jdoe@example.com" }, "profile updated");
    const [record] = lines();
    expect(record.actorEmail).toBe("j***@example.com");
  });

  it("redacts well-known secret paths structurally", () => {
    const { logger, lines } = captureLogger("api");
    logger.info({ req: { headers: { authorization: "Bearer secret-token" } } }, "incoming request");
    const [record] = lines();
    expect(record.req.headers.authorization).toBe("[REDACTED]");
  });

  it("redacts password/token fields anywhere in the object", () => {
    const { logger, lines } = captureLogger("api");
    logger.info({ body: { password: "hunter2", email: "jdoe@example.com" } }, "register attempt");
    const [record] = lines();
    expect(record.body.password).toBe("[REDACTED]");
    expect(record.body.email).toBe("j***@example.com");
  });
});
