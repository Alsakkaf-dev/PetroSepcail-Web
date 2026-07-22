import { i18nBundleResponse } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withRlsTransaction } from "../db.js";
import { ApiError } from "../errors.js";

// EP-PC-030 · GET /i18n/{locale} · public — client-hydration bundle, cacheable.
// core.i18n_strings' `i18n_public_read` RLS policy is `using (true)` (S01),
// so this reads over the normal RLS-bound app_user path with actor: null —
// no reason to reach for app_service_role just because the caller is anonymous.
export function registerI18nRoutes(app: FastifyInstance): void {
  app.get<{ Params: { locale: string } }>("/api/v1/i18n/:locale", async (request, reply) => {
    const { locale } = request.params;
    if (locale !== "ar" && locale !== "en") {
      throw new ApiError("VALIDATION_ERROR", { field: "locale", reason: "must be 'ar' or 'en'" });
    }

    const rows = await withRlsTransaction(request.ctx.actor, async (client) => {
      // Column names can't be parameterized ($1) — safe here only because
      // `locale` was just checked against a strict 2-value allowlist above.
      const res = await client.query<{ key: string; value: string }>(
        `select key, ${locale} as value from core.i18n_strings`
      );
      return res.rows;
    });

    const strings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return reply.code(200).send(i18nBundleResponse.parse({ locale, strings }));
  });
}
