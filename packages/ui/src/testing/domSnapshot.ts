// TC-PC08-002 helper: every core component is rendered once with a real
// document set to `dir=rtl/lang=ar` and once to `dir=ltr/lang=en`. Structural
// parity means the same element tree (tag + class list) comes out both
// times — only text content and the inherited `dir` should differ. Layout
// mirroring itself is CSS's job (logical properties), so this test proves
// components never branch their *markup* on direction, which is the one
// thing a browser-level RTL/LTR toggle cannot fix for you.
export interface StructuralNode {
  tag: string;
  classes: string[];
  children: StructuralNode[];
}

export function structuralSignature(root: Element): StructuralNode {
  return {
    tag: root.tagName.toLowerCase(),
    classes: [...root.classList].sort(),
    children: [...root.children].map((child) => structuralSignature(child))
  };
}

export function withDocumentDirection<T>(dir: "rtl" | "ltr", lang: "ar" | "en", fn: () => T): T {
  const prevDir = document.documentElement.dir;
  const prevLang = document.documentElement.lang;
  document.documentElement.dir = dir;
  document.documentElement.lang = lang;
  try {
    return fn();
  } finally {
    document.documentElement.dir = prevDir;
    document.documentElement.lang = prevLang;
  }
}
