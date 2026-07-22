import { errorEnvelope } from "@petrospecial/contracts";

// D-09 / FR-PC04-004: single error-code registry, envelope
// {error:{code,message,details}}, authoritative source
// 05-api-specification.md §8. Each code also carries the core.i18n_strings
// key holding its AR/EN user-facing message (seeded by db/migrations/0009,
// S02) — the full locale-resolution pipeline (EP-PC-030, Accept-Language,
// etc.) is PC-07's job in S05; `message` here is the EN default so the
// envelope is useful before that lands.
//
// CORRECTION (S03): S02 wrote this registry before §8 was in scope
// (Delta-Reading — S02's Read line didn't include it) and invented
// `INTERNAL_ERROR`; the authoritative code is `INTERNAL`. Fixed here, plus
// the three codes S02 had no reason to need yet: RATE_LIMITED (PC-GW-2,
// this session), PAYLOAD_TOO_LARGE / CONFLICT (no endpoint uses them yet —
// registered now so the registry is complete per FR-PC04-004, wired by
// whichever future session needs them).
export const ERROR_REGISTRY = {
  VALIDATION_ERROR: { status: 422, messageKey: "error.validation_error", message: "Validation failed." },
  IDENTITY_EXISTS: {
    status: 409,
    messageKey: "error.identity_exists",
    message: "An account with this email or phone already exists."
  },
  TOKEN_INVALID: { status: 410, messageKey: "error.token_invalid", message: "This link or code is invalid or has expired." },
  INVALID_CREDENTIALS: { status: 401, messageKey: "error.invalid_credentials", message: "Incorrect email or password." },
  EMAIL_UNVERIFIED: {
    status: 403,
    messageKey: "error.email_unverified",
    message: "Please verify your email before signing in."
  },
  ACCOUNT_LOCKED: {
    status: 423,
    messageKey: "error.account_locked",
    message: "This account is temporarily locked due to too many failed attempts."
  },
  MFA_REQUIRED: { status: 401, messageKey: "error.mfa_required", message: "A verification code is required." },
  MFA_INVALID: { status: 401, messageKey: "error.mfa_invalid", message: "The verification code is invalid." },
  TOKEN_REUSE_DETECTED: {
    status: 401,
    messageKey: "error.token_reuse_detected",
    message: "This session is no longer valid. Please sign in again."
  },
  FORBIDDEN: { status: 403, messageKey: "error.forbidden", message: "You do not have permission to do this." },
  NOT_FOUND: { status: 404, messageKey: "error.not_found", message: "Not found." },
  RATE_LIMITED: { status: 429, messageKey: "error.rate_limited", message: "Too many requests. Please slow down." },
  PAYLOAD_TOO_LARGE: { status: 413, messageKey: "error.payload_too_large", message: "The upload exceeds the size limit." },
  CONFLICT: { status: 409, messageKey: "error.conflict", message: "This conflicts with the current state." },
  INTERNAL: { status: 500, messageKey: "error.internal", message: "An unexpected error occurred." },
  // 10-customer-storefront/05-api-specification.md §10 (SF error registry, S08).
  CART_EMPTY: { status: 422, messageKey: "error.cart_empty", message: "Checkout attempted on an empty cart." },
  CART_LINE_UNAVAILABLE: {
    status: 409,
    messageKey: "error.cart_line_unavailable",
    message: "This item is out of stock."
  },
  PRICE_CHANGED: { status: 409, messageKey: "error.price_changed", message: "A price changed since you added this item." },
  OUT_OF_DELIVERY_RADIUS: {
    status: 422,
    messageKey: "error.out_of_delivery_radius",
    message: "This address is outside our delivery area."
  },
  COD_LIMIT_EXCEEDED: {
    status: 422,
    messageKey: "error.cod_limit_exceeded",
    message: "This order total exceeds the cash-on-delivery limit. Please use bank transfer."
  },
  PAYMENT_WINDOW_EXPIRED: {
    status: 410,
    messageKey: "error.payment_window_expired",
    message: "The payment window for this order has expired."
  }
} as const;

export type ErrorCode = keyof typeof ERROR_REGISTRY;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, details?: unknown) {
    super(ERROR_REGISTRY[code].message);
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_REGISTRY[this.code].status;
  }

  toEnvelope() {
    return errorEnvelope.parse({
      error: {
        code: this.code,
        message: ERROR_REGISTRY[this.code].message,
        ...(this.details !== undefined ? { details: this.details } : {})
      }
    });
  }
}
