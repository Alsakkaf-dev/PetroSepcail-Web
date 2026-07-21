// D-09 / FR-PC04-004: single error-code registry, envelope
// {error:{code,message,details}}. Each code also carries the core.i18n_strings
// key holding its AR/EN user-facing message (seeded by db/migrations/0009,
// S02) — the full locale-resolution pipeline (EP-PC-030, Accept-Language,
// etc.) is PC-07's job in S05; `message` here is the EN default so the
// envelope is useful before that lands.
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
  INTERNAL_ERROR: { status: 500, messageKey: "error.internal_error", message: "An unexpected error occurred." }
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
    return {
      error: {
        code: this.code,
        message: ERROR_REGISTRY[this.code].message,
        ...(this.details !== undefined ? { details: this.details } : {})
      }
    };
  }
}
