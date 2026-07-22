import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone, maskPii } from "./piiMask";

describe("maskEmail", () => {
  it("masks the local part, keeps the first char and the full domain", () => {
    expect(maskEmail("contact jdoe@example.com now")).toBe("contact j***@example.com now");
  });

  it("masks multiple emails in the same string", () => {
    expect(maskEmail("a@x.com and b@y.com")).toBe("a***@x.com and b***@y.com");
  });

  it("leaves text without an email untouched", () => {
    expect(maskEmail("no pii here")).toBe("no pii here");
  });
});

describe("maskPhone", () => {
  it("masks a Saudi mobile with +966 prefix", () => {
    expect(maskPhone("call +966512345678 today")).toBe("call +966***78 today");
  });

  it("masks a Saudi mobile with leading zero", () => {
    expect(maskPhone("call 0512345678 today")).toBe("call 0512***78 today");
  });

  it("leaves non-Saudi digit runs untouched", () => {
    expect(maskPhone("order #12345678")).toBe("order #12345678");
  });
});

describe("maskPii", () => {
  it("masks both email and phone in one pass", () => {
    expect(maskPii("jdoe@example.com / +966512345678")).toBe("j***@example.com / +966***78");
  });
});
