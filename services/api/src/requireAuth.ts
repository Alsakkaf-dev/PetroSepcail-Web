import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";
import { verifyAccessToken, type AccessTokenClaims } from "./security/jwt.js";

// Minimal Bearer-token extraction for the /auth/* endpoints that need it
// (logout, mfa/enroll, mfa/confirm, account/delete). The full request-context
// gateway (request_id, locale resolution, rate limiting — FR-PC04-002) is
// PC-GW-3's job in S03; this is deliberately narrow to this session's scope.
export async function requireAuth(request: FastifyRequest): Promise<AccessTokenClaims> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError("INVALID_CREDENTIALS", { reason: "missing bearer token" });
  }
  try {
    return await verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    throw new ApiError("INVALID_CREDENTIALS", { reason: "invalid or expired token" });
  }
}
