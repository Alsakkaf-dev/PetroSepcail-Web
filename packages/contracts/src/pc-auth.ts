import { z } from "zod";

// 60-platform-core/05-api-specification.md §1 (EP-PC-001..010), PC-01/PC-02.
// Request/response body shapes only — auth/routing/status-code details live
// in the API spec doc and the route handlers themselves.

const e164Phone = z.string().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164, e.g. +9665XXXXXXXX");
const locale = z.enum(["ar", "en"]);
const userRole = z.enum(["customer", "supplier", "driver", "admin", "super_admin"]);

// EP-PC-001 · POST /auth/register
export const registerRequest = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().email(),
  phone: e164Phone,
  password: z.string().min(10), // FR-PC01-001: "password (>=10 chars)"
  locale: locale.optional()
});
export type RegisterRequest = z.infer<typeof registerRequest>;

export const registerResponse = z.object({
  identityId: z.string().uuid(),
  status: z.literal("pending_verification"),
  verifyLink: z.string().url().optional() // only when email.mode=onscreen
});
export type RegisterResponse = z.infer<typeof registerResponse>;

// EP-PC-002 · POST /auth/verify-email
export const verifyEmailRequest = z.object({ token: z.string().min(1) });
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequest>;

export const verifyEmailResponse = z.object({ status: z.literal("active") });
export type VerifyEmailResponse = z.infer<typeof verifyEmailResponse>;

// EP-PC-003 · POST /auth/login
export const loginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  role: userRole.optional(),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional()
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const loginSuccessResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  role: userRole
});
export type LoginSuccessResponse = z.infer<typeof loginSuccessResponse>;

export const loginRoleSelectionResponse = z.object({
  status: z.literal("role_selection_required"),
  roles: z.array(userRole)
});
export type LoginRoleSelectionResponse = z.infer<typeof loginRoleSelectionResponse>;

// EP-PC-004 · POST /auth/refresh
export const refreshRequest = z.object({ refreshToken: z.string().min(1) });
export type RefreshRequest = z.infer<typeof refreshRequest>;

export const refreshResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive()
});
export type RefreshResponse = z.infer<typeof refreshResponse>;

// EP-PC-006 · POST /auth/password-reset/request
export const passwordResetRequestRequest = z.object({ email: z.string().email() });
export type PasswordResetRequestRequest = z.infer<typeof passwordResetRequestRequest>;

// EP-PC-007 · POST /auth/password-reset/confirm
export const passwordResetConfirmRequest = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(10)
});
export type PasswordResetConfirmRequest = z.infer<typeof passwordResetConfirmRequest>;

// EP-PC-008 · POST /auth/mfa/enroll (auth, admin roles). `totp` is required
// only when the caller already has a confirmed secret — re-enrolling without
// proving the current device would silently strip MFA from the account (the
// upsert always resets `confirmed_at` to null), so a reset must be
// authorized by the credential it would replace, same as any other
// security-boundary change.
export const mfaEnrollRequest = z.object({
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional()
});
export type MfaEnrollRequest = z.infer<typeof mfaEnrollRequest>;

export const mfaEnrollResponse = z.object({
  otpauthUri: z.string(),
  secretMasked: z.string()
});
export type MfaEnrollResponse = z.infer<typeof mfaEnrollResponse>;

// EP-PC-009 · POST /auth/mfa/confirm
export const mfaConfirmRequest = z.object({ totp: z.string().regex(/^\d{6}$/) });
export type MfaConfirmRequest = z.infer<typeof mfaConfirmRequest>;

export const mfaConfirmResponse = z.object({ enabled: z.literal(true) });
export type MfaConfirmResponse = z.infer<typeof mfaConfirmResponse>;

// EP-PC-010 · POST /auth/account/delete (auth)
export const accountDeleteResponse = z.object({
  status: z.literal("pending_deletion"),
  purgeAfter: z.string().datetime()
});
export type AccountDeleteResponse = z.infer<typeof accountDeleteResponse>;

// 00-INDEX §4.3 / D-09 error envelope, shared by every EP-PC endpoint.
export const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional()
  })
});
export type ErrorEnvelope = z.infer<typeof errorEnvelope>;
