// SF-UI-1 (TC-SF-I18N-001): AR-first, client-toggleable, matching the
// legacy static site's own `?lang=` + `dir` pattern (memory: the site itself
// persists the choice in localStorage `ps-lang`; a query param is this
// server-rendered app's equivalent switch). No PC-07 hydration bundle is
// wired into apps/store yet (S06 handover) — every string used here is one
// of the two locale fields the catalog API already returns per item
// (nameAr/nameEn etc.), so no separate i18n dictionary is needed for these
// screens specifically.
export type Locale = "ar" | "en";

export function parseLocale(value: string | string[] | undefined): Locale {
  return value === "en" ? "en" : "ar";
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function otherLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar";
}

const STRINGS: Record<Locale, Record<string, string>> = {
  ar: {
    catalog: "المنتجات",
    search: "بحث",
    home: "الرئيسية",
    inStock: "متوفر",
    outOfStock: "غير متوفر",
    from: "يبدأ من",
    sar: "ر.س",
    switchLang: "English",
    noResults: "لا توجد نتائج مطابقة",
    tryAgain: "جرّب كلمات أخرى أو تصفح الفئات التالية:",
    specs: "المواصفات",
    benefits: "الفوائد والمميزات",
    quality: "الجودة والثقة",
    manufacturer: "معلومات الشركة المصنعة",
    hse: "الصحة والسلامة والبيئة",
    certifications: "الشهادات",
    relatedProducts: "منتجات ذات صلة",
    searchPlaceholder: "ابحث عن منتج...",
    allFamilies: "كل العائلات",
    packSize: "الحجم"
  },
  en: {
    catalog: "Products",
    search: "Search",
    home: "Home",
    inStock: "In stock",
    outOfStock: "Out of stock",
    from: "From",
    sar: "SAR",
    switchLang: "العربية",
    noResults: "No matching results",
    tryAgain: "Try different keywords, or browse a family:",
    specs: "Specifications",
    benefits: "Key benefits",
    quality: "Quality & trust",
    manufacturer: "Manufacturer information",
    hse: "Health, safety & environment",
    certifications: "Certifications",
    relatedProducts: "Related products",
    searchPlaceholder: "Search for a product...",
    allFamilies: "All families",
    packSize: "Size"
  }
};

export function t(locale: Locale, key: keyof (typeof STRINGS)["ar"]): string {
  return STRINGS[locale][key] ?? key;
}
