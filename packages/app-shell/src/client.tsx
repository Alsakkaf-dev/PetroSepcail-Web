"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LanguageToggle } from "@petrospecial/ui";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  otherLocale,
  t,
  type Locale
} from "@petrospecial/i18n";

const LocaleContext = createContext<Locale | null>(null);

/**
 * Seeds every Client Component with the locale the server already resolved,
 * so nothing has to re-read a cookie or a query param on the client.
 *
 * This is what replaces `useLocale()` reading `useSearchParams()`. That hook
 * forced a `<Suspense fallback={null}>` + `PageInner()` wrapper around 27
 * pages purely to satisfy the App Router's static-export check — a whole
 * layer of boilerplate that existed only because locale lived in the URL.
 */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  const locale = useContext(LocaleContext);
  if (!locale) throw new Error("useLocale must be used within a LocaleProvider");
  return locale;
}

/** `t()` bound to the active locale, for Client Components. */
export function useT() {
  const locale = useLocale();
  return useMemo(() => t.bind(null, locale) as (...args: DropFirst<Parameters<typeof t>>) => string, [locale]);
}

type DropFirst<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : never;

/**
 * The language switch, wired to persistence.
 *
 * Mirrors the marketing site exactly: one button showing the language you
 * would switch *to* ("EN" while reading Arabic), never a two-way segmented
 * control.
 *
 * Persistence is deliberately double-written. The cookie is what the server
 * reads to emit `<html lang dir>`; `localStorage` under the same `ps-lang`
 * key is what the marketing site already uses, so a visitor crossing from
 * petrospecial.com into the storefront keeps their choice either way.
 * `router.refresh()` re-renders the server tree so `<html>` updates in place
 * — a full reload would lose scroll position and any in-progress form.
 */
export function LocaleSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();

  const onToggle = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
      try {
        window.localStorage.setItem(LOCALE_COOKIE, next);
      } catch {
        // Private-mode or a storage quota refusal must not break the toggle;
        // the cookie above is the authoritative half.
      }
      router.refresh();
    },
    [router]
  );

  return (
    <LanguageToggle
      locale={locale}
      onToggle={onToggle}
      className={className}
      ariaLabel={{
        ar: t("ar", "common.switchLanguage"),
        en: t("en", "common.switchLanguage")
      }}
    />
  );
}

export { otherLocale };
