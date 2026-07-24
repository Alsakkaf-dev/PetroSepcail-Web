// SF-UI-1 (TC-SF-I18N-001): AR-first, client-toggleable, matching the
// legacy static site's own `?lang=` + `dir` pattern (memory: the site itself
// persists the choice in localStorage `ps-lang`; a query param is this
// server-rendered app's equivalent switch). No PC-07 hydration bundle is
// wired into apps/store yet (S06 handover) — every string used here is one
// of the two locale fields the catalog API already returns per item
// (nameAr/nameEn etc.), so no separate i18n dictionary is needed for these
// screens specifically.
import { useSearchParams } from "next/navigation";

export type Locale = "ar" | "en";

export function parseLocale(value: string | string[] | undefined): Locale {
  return value === "en" ? "en" : "ar";
}

// Client-component counterpart of the server-side `searchParams.lang` prop
// pattern (see catalog/page.tsx): cart/checkout/orders/account are "use
// client" pages with no server parent to hand them a `locale` prop, so they
// read the same `?lang=` query param themselves via next/navigation. Only
// called from client components, but the import itself is safe from a
// shared module also used server-side (catalog/page.tsx never calls it).
export function useLocale(): Locale {
  const params = useSearchParams();
  return parseLocale(params.get("lang") ?? undefined);
}

export function localeDateString(locale: Locale, iso: string): string {
  return new Date(iso).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US");
}

export function localeDateTimeString(locale: Locale, iso: string): string {
  return new Date(iso).toLocaleString(locale === "ar" ? "ar-SA" : "en-US");
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
    packSize: "الحجم",
    // SF-03 cart
    cartTitle: "سلة المشتريات",
    loginToViewCart: "سجّل الدخول لعرض سلتك",
    cartEmpty: "سلتك فارغة.",
    browseProducts: "تصفح المنتجات",
    currentlyUnavailable: "غير متوفر حاليًا",
    priceUpdated: "تم تحديث السعر",
    remove: "إزالة",
    subtotal: "المجموع الفرعي:",
    vat: "الضريبة:",
    total: "الإجمالي:",
    freeDeliveryHintPrefix: "أضف",
    freeDeliveryHintSuffix: "أخرى للحصول على توصيل مجاني",
    proceedToCheckout: "إتمام الشراء",
    // SF-04 checkout
    checkoutTitle: "إتمام الشراء",
    addressLabel: "العنوان",
    addNewAddress: "+ عنوان جديد",
    fullNamePlaceholder: "الاسم الكامل",
    recipientNamePlaceholder: "الاسم",
    phonePlaceholder: "الجوال",
    addressLine1Placeholder: "العنوان",
    latPlaceholder: "خط العرض (اختياري)",
    lngPlaceholder: "خط الطول (اختياري)",
    saveAddress: "حفظ العنوان",
    deliveryLabel: "التوصيل",
    calculateDeliveryFee: "احسب رسوم التوصيل",
    deliveryFee: "رسوم التوصيل:",
    free: "(مجاني)",
    paymentMethodLabel: "طريقة الدفع",
    cod: "الدفع عند الاستلام",
    bankTransfer: "تحويل بنكي",
    cardComingSoon: "الدفع بالبطاقة قريبًا",
    placingOrder: "جارٍ التأكيد...",
    confirmOrder: "تأكيد الطلب",
    // SF-05 orders
    myOrders: "طلباتي",
    loginToViewOrders: "سجّل الدخول لعرض طلباتك",
    noOrdersYet: "لا توجد طلبات سابقة.",
    loading: "جارٍ التحميل...",
    orderConfirmed: "تم تأكيد الطلب",
    orderNumber: "رقم الطلب:",
    statusHistory: "سجل الحالة",
    cancelOrder: "إلغاء الطلب",
    confirmReceipt: "تأكيد الاستلام",
    codDueLabel: "الدفع نقدًا عند الاستلام — المبلغ المستحق:",
    transferAmountTo: "حوّل المبلغ إلى:",
    proofReceivedPendingVerification: "تم استلام إثبات التحويل — بانتظار التحقق.",
    bankRefPlaceholder: "رقم مرجع التحويل",
    submitProof: "إرسال إثبات التحويل",
    // SF-10 account
    myAccount: "حسابي",
    loginToViewAccount: "سجّل الدخول لعرض حسابك",
    profile: "الملف الشخصي",
    save: "حفظ",
    savedConfirmation: "تم الحفظ.",
    overview: "نظرة عامة",
    savedAddressesCount: "عدد العناوين المحفوظة:",
    openReturnsCount: "الطلبات المرتجعة المفتوحة:",
    viewAllOrders: "عرض كل الطلبات",
    loyaltyPoints: "نقاط الولاء",
    balanceLabel: "الرصيد:",
    pointsUnit: "نقطة",
    everyLabel: "كل",
    marketingConsents: "التسويق والاتصالات",
    marketingOptIn: "أوافق على استقبال العروض التسويقية",
    // shared login form
    emailPlaceholder: "البريد الإلكتروني",
    passwordPlaceholder: "كلمة المرور",
    signIn: "دخول"
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
    packSize: "Size",
    // SF-03 cart
    cartTitle: "Cart",
    loginToViewCart: "Sign in to view your cart",
    cartEmpty: "Your cart is empty.",
    browseProducts: "Browse products",
    currentlyUnavailable: "Currently unavailable",
    priceUpdated: "Price updated",
    remove: "Remove",
    subtotal: "Subtotal:",
    vat: "VAT:",
    total: "Total:",
    freeDeliveryHintPrefix: "Add",
    freeDeliveryHintSuffix: "more for free delivery",
    proceedToCheckout: "Checkout",
    // SF-04 checkout
    checkoutTitle: "Checkout",
    addressLabel: "Address",
    addNewAddress: "+ New address",
    fullNamePlaceholder: "Full name",
    recipientNamePlaceholder: "Name",
    phonePlaceholder: "Phone",
    addressLine1Placeholder: "Address",
    latPlaceholder: "Latitude (optional)",
    lngPlaceholder: "Longitude (optional)",
    saveAddress: "Save address",
    deliveryLabel: "Delivery",
    calculateDeliveryFee: "Calculate delivery fee",
    deliveryFee: "Delivery fee:",
    free: "(free)",
    paymentMethodLabel: "Payment method",
    cod: "Cash on delivery",
    bankTransfer: "Bank transfer",
    cardComingSoon: "Card payment coming soon",
    placingOrder: "Placing order...",
    confirmOrder: "Confirm order",
    // SF-05 orders
    myOrders: "My orders",
    loginToViewOrders: "Sign in to view your orders",
    noOrdersYet: "No previous orders.",
    loading: "Loading...",
    orderConfirmed: "Order confirmed",
    orderNumber: "Order number:",
    statusHistory: "Status history",
    cancelOrder: "Cancel order",
    confirmReceipt: "Confirm receipt",
    codDueLabel: "Cash on delivery — amount due:",
    transferAmountTo: "Transfer the amount to:",
    proofReceivedPendingVerification: "Transfer proof received — pending verification.",
    bankRefPlaceholder: "Bank transfer reference",
    submitProof: "Submit transfer proof",
    // SF-10 account
    myAccount: "My account",
    loginToViewAccount: "Sign in to view your account",
    profile: "Profile",
    save: "Save",
    savedConfirmation: "Saved.",
    overview: "Overview",
    savedAddressesCount: "Saved addresses:",
    openReturnsCount: "Open returns:",
    viewAllOrders: "View all orders",
    loyaltyPoints: "Loyalty points",
    balanceLabel: "Balance:",
    pointsUnit: "points",
    everyLabel: "every",
    marketingConsents: "Marketing & communications",
    marketingOptIn: "I agree to receive marketing offers",
    // shared login form
    emailPlaceholder: "Email",
    passwordPlaceholder: "Password",
    signIn: "Sign in"
  }
};

export function t(locale: Locale, key: keyof (typeof STRINGS)["ar"]): string {
  return STRINGS[locale][key] ?? key;
}

// D-04's order_status enum is frozen platform-wide — one shared bilingual
// label map instead of each SF-05 screen keeping its own copy.
const ORDER_STATUS_LABELS: Record<Locale, Record<string, string>> = {
  ar: {
    pending_payment: "بانتظار الدفع",
    paid: "تم الدفع",
    confirmed: "مؤكد",
    preparing: "قيد التجهيز",
    ready_for_pickup: "جاهز للتسليم",
    assigned: "تم تعيين سائق",
    picked_up: "تم الاستلام من المستودع",
    en_route: "في الطريق",
    delivered: "تم التوصيل",
    confirmed_received: "تم تأكيد الاستلام",
    cancelled: "ملغى",
    refunded: "مسترد",
    returned: "مرتجع"
  },
  en: {
    pending_payment: "Pending payment",
    paid: "Paid",
    confirmed: "Confirmed",
    preparing: "Preparing",
    ready_for_pickup: "Ready for pickup",
    assigned: "Driver assigned",
    picked_up: "Picked up from warehouse",
    en_route: "En route",
    delivered: "Delivered",
    confirmed_received: "Receipt confirmed",
    cancelled: "Cancelled",
    refunded: "Refunded",
    returned: "Returned"
  }
};

export function orderStatusLabel(locale: Locale, status: string): string {
  return ORDER_STATUS_LABELS[locale][status] ?? status;
}

// SF-04 checkout delivery slots (core.settings-configurable per D-06, but
// the slot codes themselves are a fixed small set).
const SLOT_LABELS: Record<Locale, Record<string, string>> = {
  ar: {
    same_day: "اليوم",
    next_am: "غدًا صباحًا (9–13)",
    next_pm: "غدًا مساءً (14–20)"
  },
  en: {
    same_day: "Today",
    next_am: "Tomorrow morning (9–13)",
    next_pm: "Tomorrow afternoon (14–20)"
  }
};

export function slotLabel(locale: Locale, code: string): string {
  return SLOT_LABELS[locale][code] ?? code;
}
