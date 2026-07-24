"use client";

import { useSearchParams } from "next/navigation";
import { parseLocale, type Locale } from "./locale";

// Split out of locale.ts: that file is also imported by server components
// (e.g. app/search/page.tsx), and pulling useSearchParams into that import
// graph fails the Next.js App Router build even though those server
// components never call this hook. cart/checkout/orders/account are
// entirely "use client" pages with no server parent to hand them a
// searchParams-derived locale prop, so they read ?lang= themselves here.
export function useLocale(): Locale {
  const params = useSearchParams();
  return parseLocale(params.get("lang") ?? undefined);
}
