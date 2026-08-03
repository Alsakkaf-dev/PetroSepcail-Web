"use client";

import { useSearchParams } from "next/navigation";
import { parseLocale, type Locale } from "./locale";

export function useLocale(): Locale {
  const params = useSearchParams();
  return parseLocale(params.get("lang") ?? undefined);
}
