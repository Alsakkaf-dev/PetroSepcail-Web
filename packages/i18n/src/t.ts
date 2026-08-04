import { DICTIONARY, type StringKey } from "./dictionary";
import type { Locale } from "./locale";

/**
 * Remote overrides from PC-07's `core.i18n_strings` (EP-PC-030), merged over
 * the vendored bundle. Empty until the hydration bundle is wired — see
 * DEFERRED-DECISIONS §4 item 15. Keys are already `section.item`, so this is
 * a drop-in when it lands.
 */
const overrides: { [L in Locale]: Partial<Record<string, string>> } = { ar: {}, en: {} };

export function hydrate(locale: Locale, strings: Record<string, string>): void {
  overrides[locale] = { ...overrides[locale], ...strings };
}

/**
 * Interpolate `{name}` placeholders. Values are inserted verbatim — every
 * caller passes already-formatted output (money(), count(), dateTime()), so
 * this never has to know about number or date shape.
 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

/**
 * The only way a user-facing string reaches a screen.
 *
 * `key` is typed against the Arabic bundle, so a typo or a key that exists in
 * only one locale fails at compile time rather than rendering its own key.
 */
export function t(locale: Locale, key: StringKey, vars?: Record<string, string | number>): string {
  const override = overrides[locale][key];
  return interpolate(override ?? DICTIONARY[locale][key], vars);
}

/**
 * Translate an API error into something a person can read.
 *
 * The API answers with a machine code from its registry (services/api/src/
 * errors.ts, 37 codes) — `CREDIT_LIMIT_EXCEEDED`, `OTP_MISMATCH`. Screens
 * used to render those codes raw, alongside strings like
 * "GET /api/v1/cart failed: 500" and a bare lowercase "failed". None of that
 * may reach a user. Unmapped codes fall back to the generic message rather
 * than leaking the code itself.
 */
export function errorMessage(locale: Locale, code: string | undefined | null): string {
  if (!code) return t(locale, "error.internal");
  const key = `error.${code.toLowerCase()}` as StringKey;
  if (key in DICTIONARY[locale]) return t(locale, key);
  if (code === "NOT_LOGGED_IN") return t(locale, "error.notLoggedIn");
  if (code === "NETWORK_UNREACHABLE") return t(locale, "error.network");
  return t(locale, "error.internal");
}
