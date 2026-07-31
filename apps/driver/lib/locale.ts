// Same ?lang= client-toggle convention as apps/store/lib/locale.ts (SF-UI-1)
// — this file has no server component importing it yet (every driver page
// is "use client", no server parent to hand a searchParams-derived locale
// prop), but the split from useLocale.ts is kept anyway for consistency
// with the store app and in case a server page is added later.
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
    appTitle: "سائق بترو سبيشل",
    emailPlaceholder: "البريد الإلكتروني",
    passwordPlaceholder: "كلمة المرور",
    signIn: "دخول",
    switchLang: "English",
    startShift: "بدء المناوبة",
    manifest: "المهام",
    loading: "جارٍ التحميل...",
    noShift: "لا توجد مناوبة مفتوحة",
    startShiftAction: "بدء التحميل",
    vanPlate: "رقم لوحة الفان",
    goToManifest: "الذهاب إلى المهام",
    noTasks: "لا توجد مهام حالية",
    accept: "قبول",
    decline: "رفض",
    viewTask: "عرض التفاصيل",
    taskDetails: "تفاصيل المهمة",
    recipient: "المستلم",
    lines: "الأصناف",
    codAmount: "المبلغ المستحق نقدًا",
    transitionTo: "الانتقال إلى",
    atPickup: "وصل نقطة الاستلام",
    pickedUp: "تم التحميل",
    enRoute: "في الطريق",
    arrived: "وصل الوجهة",
    back: "رجوع",
    errorGeneric: "حدث خطأ، حاول مجددًا",
    b2bDrop: "تسليم تجاري",
    b2cHome: "توصيل منزلي",
    b2cPickup: "نقطة استلام"
  },
  en: {
    appTitle: "PetroSpecial Driver",
    emailPlaceholder: "Email",
    passwordPlaceholder: "Password",
    signIn: "Sign in",
    switchLang: "العربية",
    startShift: "Start shift",
    manifest: "Manifest",
    loading: "Loading...",
    noShift: "No open shift",
    startShiftAction: "Start load-out",
    vanPlate: "Van plate",
    goToManifest: "Go to manifest",
    noTasks: "No active tasks",
    accept: "Accept",
    decline: "Decline",
    viewTask: "View details",
    taskDetails: "Task details",
    recipient: "Recipient",
    lines: "Items",
    codAmount: "Cash due on delivery",
    transitionTo: "Move to",
    atPickup: "At pickup",
    pickedUp: "Picked up",
    enRoute: "En route",
    arrived: "Arrived",
    back: "Back",
    errorGeneric: "Something went wrong, try again",
    b2bDrop: "B2B drop-off",
    b2cHome: "Home delivery",
    b2cPickup: "Pickup point"
  }
};

export function t(locale: Locale, key: keyof (typeof STRINGS)["ar"]): string {
  return STRINGS[locale][key] ?? key;
}
