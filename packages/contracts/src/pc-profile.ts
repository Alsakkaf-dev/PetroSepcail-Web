import { z } from "zod";

// 60-platform-core/05-api-specification.md §2 (Profile & addresses, PC-01).
// Only EP-PC-011 lands in S03 — as the concrete proof that PC-GW-3's RLS
// session wiring works through the real API path, not just raw SQL
// (db/migrations' scripts/test-rls.mjs already proved the SQL side in S01).
// EP-PC-012..015 (update profile, address CRUD) are unbuilt — no session
// owns them explicitly yet (flagged in S02's Handover Brief).
const userRole = z.enum(["customer", "supplier", "driver", "admin", "super_admin"]);

// EP-PC-011 · GET /me · auth
export const meResponse = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string().email(),
  phone: z.string(),
  locale: z.enum(["ar", "en"]),
  roles: z.array(userRole)
});
export type MeResponse = z.infer<typeof meResponse>;
