"use client";

import { cx } from "../../utils/cx";
import type { Locale } from "../../utils/locale";

export interface LanguageToggleProps {
  locale: Locale;
  onToggle: (next: Locale) => void;
  /** aria-label per locale, e.g. { ar: "تبديل اللغة", en: "Switch language" }. */
  ariaLabel: Record<Locale, string>;
  className?: string;
}

const OTHER_LOCALE: Record<Locale, Locale> = { ar: "en", en: "ar" };
const LABEL: Record<Locale, string> = { ar: "عربي", en: "EN" };

/** PC-08 core set — mirrors the live site's single toggle button: it always
 * shows the *target* language's label ("EN" while in Arabic, "عربي" while in
 * English) rather than a two-way segmented control. */
export function LanguageToggle({ locale, onToggle, ariaLabel, className }: LanguageToggleProps) {
  const target = OTHER_LOCALE[locale];
  return (
    <button
      type="button"
      className={cx("ps-lang-toggle", className)}
      aria-label={ariaLabel[locale]}
      onClick={() => onToggle(target)}
    >
      <span className="ps-lang-toggle__label">{LABEL[target]}</span>
    </button>
  );
}
