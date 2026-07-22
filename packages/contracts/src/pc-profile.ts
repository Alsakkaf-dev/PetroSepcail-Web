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

// EP-PC-013/014/015 (S08: SF-04 checkout needs a saved-address selector —
// flagged unbuilt since S02, picked up here as the genuine prerequisite it
// turned out to be).
export const addressRow = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  recipientName: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  district: z.string().nullable(),
  city: z.string(),
  lat: z.string().nullable(),
  lng: z.string().nullable(),
  isDefault: z.boolean()
});
export type AddressRow = z.infer<typeof addressRow>;

// EP-PC-013 · GET /me/addresses · auth
export const addressListResponse = z.object({ items: z.array(addressRow) });

// EP-PC-014 · POST /me/addresses · auth
export const addressCreateRequest = z.object({
  label: z.string().nullable().optional(),
  recipientName: z.string().min(1),
  phone: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  city: z.string().min(1).default("Jeddah"),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  isDefault: z.boolean().optional()
});
export type AddressCreateRequest = z.infer<typeof addressCreateRequest>;

// EP-PC-015 · PATCH /me/addresses/{id} · auth
export const addressUpdateRequest = addressCreateRequest.partial();
export type AddressUpdateRequest = z.infer<typeof addressUpdateRequest>;
