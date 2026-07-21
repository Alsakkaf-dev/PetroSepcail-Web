import { z } from "zod";

// 60-platform-core/05-api-specification.md §5 (Config & flags, PC-12).
// EP-PC-040/041 settings, EP-PC-042/043 feature flags.

export const settingRow = z.object({
  key: z.string(),
  value: z.unknown(),
  updatedBy: z.string().uuid().nullable(),
  updatedAt: z.string().datetime()
});
export type SettingRow = z.infer<typeof settingRow>;

// EP-PC-040 · GET /admin/settings · auth(admin)
export const settingsListResponse = z.array(settingRow);

// EP-PC-041 · PUT /admin/settings/{key} · auth (super_admin — see route comment)
export const settingUpdateRequest = z.object({ value: z.unknown() });
export type SettingUpdateRequest = z.infer<typeof settingUpdateRequest>;

// EP-PC-042 · GET /admin/feature-flags · auth(admin)
export const featureFlagsListResponse = z.array(settingRow);

// EP-PC-043 · PUT /admin/feature-flags/{key} · auth(super_admin for payments/zatca)
export const featureFlagUpdateRequest = z.object({ value: z.unknown() });
export type FeatureFlagUpdateRequest = z.infer<typeof featureFlagUpdateRequest>;
