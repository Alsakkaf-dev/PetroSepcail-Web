// Typed access to the generated CSS custom properties, for the rare case a
// component needs a token value in an inline style rather than a CSS class
// (e.g. runtime-selected product-family color). Prefer a CSS class + the
// `var(--token)` form in *.css files for everything else — see README.md.
import "./tokens.generated.css";
import "./base.css";

export const token = {
  bg: "var(--bg)",
  bgWarm: "var(--bg-warm)",
  bgTint: "var(--bg-tint)",
  surface: "var(--surface)",
  line: "var(--line)",
  lineSoft: "var(--line-soft)",
  gold: "var(--gold)",
  gold600: "var(--gold-600)",
  gold700: "var(--gold-700)",
  goldMetal: "var(--gold-metal)",
  blue: "var(--blue)",
  blue600: "var(--blue-600)",
  ink: "var(--ink)",
  muted: "var(--muted)",
  flame: "var(--flame)",
  fSpecial: "var(--f-special)",
  fSpecialCap: "var(--f-special-cap)",
  fPetro: "var(--f-petro)",
  fPetroCap: "var(--f-petro-cap)",
  fRaval: "var(--f-raval)",
  fRavalCap: "var(--f-raval-cap)",
  fontDisplay: "var(--font-display)",
  fontBody: "var(--font-body)",
  fontLatin: "var(--font-latin)",
  rSm: "var(--r-sm)",
  rMd: "var(--r-md)",
  rLg: "var(--r-lg)",
  rPill: "var(--r-pill)",
  shadowSm: "var(--shadow-sm)",
  shadowMd: "var(--shadow-md)",
  shadowLg: "var(--shadow-lg)",
  shadowGold: "var(--shadow-gold)",
  easeOut: "var(--ease-out)",
  dur: "var(--dur)"
} as const;

/** Product family coding (SF catalog) — PC-08 §1 "family: --f-special/-petro/-raval". */
export type ProductFamily = "special" | "petro" | "raval";

export function familyColor(family: ProductFamily): string {
  switch (family) {
    case "special":
      return token.fSpecial;
    case "petro":
      return token.fPetro;
    case "raval":
      return token.fRaval;
  }
}

export function familyCapColor(family: ProductFamily): string {
  switch (family) {
    case "special":
      return token.fSpecialCap;
    case "petro":
      return token.fPetroCap;
    case "raval":
      return token.fRavalCap;
  }
}
