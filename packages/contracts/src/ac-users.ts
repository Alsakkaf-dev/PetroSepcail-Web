import { z } from "zod";

// 40-admin-center/05-api-specification.md §8 (AC-06, S09).
const userRole = z.enum(["customer", "supplier", "driver", "admin", "super_admin"]);

// EP-AC-050 · POST /admin/users/suppliers · auth(admin)
// EP-AC-051 · POST /admin/users/drivers · auth(admin)
// EP-AC-052 · POST /admin/users/admins · auth(super_admin)
// Same request shape for all three (offline-vetted actor, no self-registration
// — FR-AC06-001); the route registered decides the resulting role.
export const provisionUserRequest = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  locale: z.enum(["ar", "en"]).default("ar")
});
export const provisionUserResponse = z.object({
  identityId: z.string().uuid(),
  role: userRole,
  status: z.literal("active"),
  // FR-AC06-001: 72h activation link (password_reset-purpose token — the
  // account is activated immediately by the admin's own vetting, so this
  // link only needs to let the invitee set their first real password, the
  // exact EP-PC-007 confirm flow already built in S02). Onscreen mode only
  // (D-17 EMAIL_MODE=onscreen), same convention as /auth/register.
  activationLink: z.string().optional()
});

// EP-AC-053 · POST /admin/users/{id}/grants · auth(super_admin) —
// FR-AC06-002: "role grants changed only by super-admin ... admin creating
// an admin is refused" (enforced by this endpoint's own auth gate, not a
// business rule inside the handler).
export const roleGrantRequest = z.object({
  role: userRole,
  action: z.enum(["grant", "revoke"])
});
export const roleGrantResponse = z.object({ identityId: z.string().uuid(), roles: z.array(userRole) });

// EP-AC-054 · POST /admin/users/{id}/status · auth(admin) — FR-AC06-003.
export const userStatusUpdateRequest = z.object({
  status: z.enum(["suspended", "active"]),
  reason: z.string().min(1)
});
export const userStatusUpdateResponse = z.object({ identityId: z.string().uuid(), status: z.enum(["suspended", "active"]) });
