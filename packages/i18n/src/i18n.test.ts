import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DICTIONARY, type StringKey } from "./dictionary";
import { errorMessage, t } from "./t";
import { bcp47, dirFor, otherLocale, parseLocale } from "./locale";
import { count, date, dateTime, maskTail, money, percent, shortId } from "./format";
import { statusLabel, statusTone, ORDER_STATUS, DELIVERY_STATUS, INVOICE_STATUS } from "./status";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("PC-07 locale resolution", () => {
  it("defaults to Arabic for anything that is not explicitly English", () => {
    expect(parseLocale(undefined)).toBe("ar");
    expect(parseLocale(null)).toBe("ar");
    expect(parseLocale("")).toBe("ar");
    expect(parseLocale("fr")).toBe("ar");
    expect(parseLocale("ar")).toBe("ar");
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale(["en", "ar"])).toBe("en");
  });

  it("maps locale to direction and BCP 47 tag", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("en")).toBe("ltr");
    expect(bcp47("ar")).toBe("ar-SA");
    expect(otherLocale("ar")).toBe("en");
  });
});

describe("PC-07 string store", () => {
  it("defines every key in both locales, with a non-empty Arabic string", () => {
    const arKeys = Object.keys(DICTIONARY.ar).sort();
    const enKeys = Object.keys(DICTIONARY.en).sort();
    expect(enKeys).toEqual(arKeys);
    for (const key of arKeys) {
      expect(DICTIONARY.ar[key as StringKey].length).toBeGreaterThan(0);
      expect(DICTIONARY.en[key as StringKey].length).toBeGreaterThan(0);
    }
  });

  it("uses section.item keys throughout (00-INDEX §4.3)", () => {
    // Digits are allowed in the item half — the domain itself is B2B/B2C
    // (driver.b2bDrop), and D-14's three workflows are named that way.
    for (const key of Object.keys(DICTIONARY.ar)) {
      expect(key).toMatch(/^[a-z][a-zA-Z]*\.[a-zA-Z0-9_]+$/);
    }
  });

  it("interpolates named placeholders", () => {
    expect(t("en", "catalog.resultsCount", { count: 23 })).toBe("23 products");
    expect(t("ar", "catalog.resultsCount", { count: 23 })).toBe("23 منتج");
  });

  it("leaves an unknown placeholder visible rather than printing undefined", () => {
    expect(t("en", "admin.asOf")).toBe("As of {time}");
  });

  // The whole point of the error mapping: a machine code must never reach a
  // screen. Screens previously rendered NOT_LOGGED_IN, bare enum values and
  // "GET /api/v1/cart failed: 500" directly to users.
  it("never returns a raw error code, even for an unmapped one", () => {
    expect(errorMessage("ar", "SOMETHING_NEW")).toBe(DICTIONARY.ar["error.internal"]);
    expect(errorMessage("en", "SOMETHING_NEW")).not.toContain("SOMETHING_NEW");
    expect(errorMessage("en", undefined)).toBe(DICTIONARY.en["error.internal"]);
    expect(errorMessage("en", "NOT_LOGGED_IN")).toBe(DICTIONARY.en["error.notLoggedIn"]);
    expect(errorMessage("en", "NETWORK_UNREACHABLE")).toBe(DICTIONARY.en["error.network"]);
  });

  it("has an AR and EN message for every code in the API error registry", () => {
    const registry = readFileSync(path.join(repoRoot, "services/api/src/errors.ts"), "utf8");
    const body = registry.slice(registry.indexOf("ERROR_REGISTRY = {"));
    const codes = [...body.matchAll(/^ {2}([A-Z][A-Z0-9_]+):\s*\{/gm)].map((m) => m[1]!);

    expect(codes.length).toBeGreaterThan(30);
    const missing = codes.filter((code) => !(`error.${code.toLowerCase()}` in DICTIONARY.ar));
    expect(missing).toEqual([]);
  });
});

describe("PC-07 formatting", () => {
  it("writes money the way each locale writes it", () => {
    expect(money("ar", "57.50")).toBe("57.50 ر.س");
    expect(money("en", "57.50")).toBe("SAR 57.50");
    expect(money("en", "1234.5")).toBe("SAR 1,234.50");
  });

  it("passes a non-numeric amount through untouched rather than printing NaN", () => {
    expect(money("en", "—")).toBe("—");
  });

  it("formats counts and percentages", () => {
    expect(count(1234)).toBe("1,234");
    expect(percent("en", 15)).toBe("15%");
    expect(percent("ar", 15)).toBe("15٪");
  });

  it("renders timestamps in Asia/Riyadh regardless of the host timezone", () => {
    // 2026-08-04T21:30:00Z is 2026-08-05 00:30 in Riyadh (UTC+3) — so the
    // Riyadh calendar day is the 5th, not the 4th.
    expect(date("en", "2026-08-04T21:30:00Z")).toContain("5");
    expect(dateTime("en", "2026-08-04T21:30:00Z")).toContain("00:30");
  });

  it("passes an unparseable date through instead of rendering Invalid Date", () => {
    expect(date("en", "not-a-date")).toBe("not-a-date");
  });

  it("writes Arabic dates with Western digits, like every other numeral", () => {
    // Plain `ar-SA` would give `٤ أغسطس ٢٠٢٦` and `١٣:٣٠`, which would have
    // sat next to `57.50 ر.س` on the same manifest row. The digit decision is
    // made once, at the top of format.ts, and dates follow it.
    const stamp = dateTime("ar", "2026-08-04T10:30:00Z");
    expect(stamp).toContain("2026");
    expect(stamp).toContain("13:30");
    expect(stamp).not.toMatch(/[٠-٩]/);
    // Still Arabic: the month name is translated, only the digits are Latin.
    expect(stamp).toMatch(/[؀-ۿ]/);
  });

  it("shortens ids and masks account tails", () => {
    expect(shortId("3f7a1b2c-9d4e-4f88-b1a2-000000000000")).toBe("3f7a1b2c…");
    expect(shortId("abc")).toBe("abc");
    expect(maskTail("SA0380000000608010167519")).toMatch(/7519$/);
    expect(maskTail("SA0380000000608010167519")).not.toContain("0380");
  });
});

describe("D-04 status labels", () => {
  it("localizes every order status, in both locales", () => {
    for (const value of Object.keys(ORDER_STATUS)) {
      expect(statusLabel("order", "ar", value)).not.toBe(value);
      expect(statusLabel("order", "en", value)).not.toBe(value);
    }
  });

  it("covers the full D-04 enum sizes", () => {
    expect(Object.keys(ORDER_STATUS)).toHaveLength(13);
    expect(Object.keys(DELIVERY_STATUS)).toHaveLength(9);
    expect(Object.keys(INVOICE_STATUS)).toHaveLength(6);
  });

  it("uses the glossary's Arabic wording verbatim", () => {
    expect(statusLabel("order", "ar", "en_route")).toBe("في الطريق إليك");
    expect(statusLabel("delivery", "ar", "en_route")).toBe("في الطريق");
    expect(statusLabel("invoice", "ar", "overdue")).toBe("متأخرة");
  });

  it("gives an overdue invoice and a failed delivery a danger tone", () => {
    expect(statusTone("invoice", "overdue")).toBe("danger");
    expect(statusTone("delivery", "failed")).toBe("danger");
    expect(statusTone("order", "delivered")).toBe("success");
  });
});
