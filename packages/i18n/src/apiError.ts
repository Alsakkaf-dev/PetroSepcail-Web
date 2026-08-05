import { DICTIONARY, type StringKey } from "./dictionary";
import { errorMessage } from "./t";
import type { Locale } from "./locale";

// The screens throw `Error` objects, not error codes.
//
// The API answers with `{error:{code,message,details}}` and its `message` is
// the English default from `services/api/src/errors.ts` — the AR/EN pair
// lives here, keyed `error.<code>`. The app-side fetch wrappers
// (`lib/authClient.ts` in each app) surface only `error.message`, so by the
// time a screen catches something, the code is gone and all that is left is
// an English sentence — which is exactly what an Arabic reader was being
// shown.
//
// Rather than reach into the auth clients, this maps the registry's English
// defaults back to their codes. It is a small, deliberate duplication of the
// messages a *sign-in* can actually produce; it grows one entry at a time as
// a screen needs it, the same way the dictionary does. Anything unrecognised
// resolves to the generic message: "GET /api/v1/cart failed: 500",
// "Failed to fetch" and a bare lowercase "failed" must never reach a screen.
const EN_MESSAGE_TO_CODE: Record<string, string> = {
  "Validation failed.": "VALIDATION_ERROR",
  "An account with this email or phone already exists.": "IDENTITY_EXISTS",
  "This link or code is invalid or has expired.": "TOKEN_INVALID",
  "Incorrect email or password.": "INVALID_CREDENTIALS",
  "Please verify your email before signing in.": "EMAIL_UNVERIFIED",
  "This account is temporarily locked due to too many failed attempts.": "ACCOUNT_LOCKED",
  "A verification code is required.": "MFA_REQUIRED",
  "The verification code is invalid.": "MFA_INVALID",
  "This session is no longer valid. Please sign in again.": "TOKEN_REUSE_DETECTED",
  "You do not have permission to do this.": "FORBIDDEN",
  "Not found.": "NOT_FOUND",
  "Too many requests. Please slow down.": "RATE_LIMITED",
  "An unexpected error occurred.": "INTERNAL"
};

/** Looks like an error code rather than a sentence: `OTP_MISMATCH`. */
const CODE_SHAPED = /^[A-Z][A-Z0-9_]*$/;

/**
 * The localised message for anything a screen catches.
 *
 * Resolution order: a thrown error code (the transport sentinels
 * `NETWORK_UNREACHABLE` / `NOT_LOGGED_IN` included) → an English registry
 * default mapped back to its code → the generic message.
 */
export function messageFor(locale: Locale, thrown: unknown): string {
  const raw = thrown instanceof Error ? thrown.message : typeof thrown === "string" ? thrown : "";
  if (!raw) return errorMessage(locale, null);

  if (CODE_SHAPED.test(raw)) return errorMessage(locale, raw);

  const code = EN_MESSAGE_TO_CODE[raw];
  if (code) return errorMessage(locale, code);

  return errorMessage(locale, null);
}

/**
 * Whether a caught error is a specific registry code — for the cases where a
 * screen does more than print the message (an `ACCOUNT_LOCKED` countdown, a
 * `CREDIT_LIMIT_EXCEEDED` block showing the shortfall).
 */
export function isApiError(thrown: unknown, code: string): boolean {
  const raw = thrown instanceof Error ? thrown.message : typeof thrown === "string" ? thrown : "";
  if (raw === code) return true;
  return EN_MESSAGE_TO_CODE[raw] === code;
}

/** True when `error.<code>` exists in the bundle — used by the tests. */
export function hasErrorKey(code: string): boolean {
  return (`error.${code.toLowerCase()}` as StringKey) in DICTIONARY.ar;
}
