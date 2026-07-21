import { z } from "zod";

// 60-platform-core/05-api-specification.md §4 (i18n, PC-07).

// EP-PC-030 · GET /i18n/{locale} · public
export const i18nBundleResponse = z.object({
  locale: z.enum(["ar", "en"]),
  strings: z.record(z.string(), z.string())
});
export type I18nBundleResponse = z.infer<typeof i18nBundleResponse>;
