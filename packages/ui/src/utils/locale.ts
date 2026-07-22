// PC-07 §2: default dir=rtl/lang=ar; en ⇒ dir=ltr. Every component that
// needs direction reads it from here rather than re-deriving it locally.
export type Locale = "ar" | "en";

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
