// PC-07 — the platform's single string store, locale primitives, formatters
// and D-04 status labels. Framework-agnostic on purpose: it is imported by
// Server Components, Client Components and plain vitest alike, so nothing in
// here may touch `next/*`, `document` or `window`.

export * from "./locale";
export * from "./dictionary";
export * from "./t";
export * from "./format";
export * from "./status";
