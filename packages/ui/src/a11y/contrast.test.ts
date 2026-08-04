import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { contrastRatio, meetsAA, WCAG_AA_LARGE_TEXT, WCAG_AA_NORMAL_TEXT } from "./contrast";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

// Literal hex mirrors of packages/ui/src/tokens/tokens.generated.css — kept
// as plain strings here (not imported from CSS) since the calculator takes
// hex input directly; see tokenAudit.test.ts for the "no literal value
// drifts from the token file" side of this guarantee.
const T = {
  ink: "#121417",
  muted: "#646b78",
  bg: "#fdfcf9",
  surface: "#ffffff",
  bgWarm: "#f7f4ec",
  bgTint: "#fff8e1",
  blue: "#16265c",
  blue600: "#1e3a8a",
  gold: "#ffc800",
  gold700: "#a37f00",
  flame: "#f15a24",
  // Semantic status (D-14 of DEFERRED-DECISIONS §4). Separate from the family
  // colors so neither has to do the other's job.
  success: "#146c43",
  successBg: "#eaf6ef",
  danger: "#a51c1c",
  dangerBg: "#fdeceb",
  warn: "#8a5a0b",
  warnBg: "#fbf1e0",
  // Family coding — never used as status, and only --f-special clears AA as
  // text on every surface. Asserted below so that stays a deliberate fact.
  fSpecial: "#1e3a8a",
  fPetro: "#a16207",
  fRaval: "#b91c1c"
};

describe("TC-PC08-003 WCAG AA contrast on token pairs actually used as text", () => {
  it.each([
    ["ink on bg (body text)", T.ink, T.bg],
    ["ink on surface (card text)", T.ink, T.surface],
    ["muted on bg (secondary text)", T.muted, T.bg],
    ["blue on surface (headings/links)", T.blue, T.surface],
    ["blue-600 on surface (nav current-page)", T.blue600, T.surface],
    ["ink on gold (primary button text)", T.ink, T.gold],
    ["ink on flame (danger button/badge text)", T.ink, T.flame],
    ["ink on bg-tint (toast/info surfaces)", T.ink, T.bgTint],
    // Semantic status foregrounds, on every surface they can land on. A
    // status message appears on a card (--surface), on the page (--bg), in a
    // recessed panel (--bg-warm) and inside its own tint, so all four pair.
    ["success on surface", T.success, T.surface],
    ["success on bg", T.success, T.bg],
    ["success on bg-warm", T.success, T.bgWarm],
    ["success on success-bg", T.success, T.successBg],
    ["danger on surface", T.danger, T.surface],
    ["danger on bg", T.danger, T.bg],
    ["danger on bg-warm", T.danger, T.bgWarm],
    ["danger on danger-bg", T.danger, T.dangerBg],
    ["warn on surface", T.warn, T.surface],
    ["warn on bg", T.warn, T.bg],
    ["warn on bg-warm", T.warn, T.bgWarm],
    ["warn on warn-bg", T.warn, T.warnBg],
    // Status tints are text surfaces in their own right (banner bodies).
    ["ink on success-bg", T.ink, T.successBg],
    ["ink on danger-bg", T.ink, T.dangerBg],
    ["ink on warn-bg", T.ink, T.warnBg],
    // --muted is the secondary-text token; it must hold on the warm recess
    // and the informational tint too, not just on --bg.
    ["muted on surface", T.muted, T.surface],
    ["muted on bg-warm", T.muted, T.bgWarm],
    // Debt (--blue) vs custody (--f-petro) accents, D-14 rule f. The
    // separation is carried by heading and label, never by color alone, but
    // both still have to be legible where they are used as text.
    ["blue on bg-warm (debt panel heading)", T.blue, T.bgWarm],
    ["f-special on surface (family label)", T.fSpecial, T.surface]
  ] as const)("%s meets 4.5:1", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(meetsAA(fg, bg)).toBe(true);
  });

  it("documents that --gold text alone fails AA normal text (large/bold only, per PC-08 §6)", () => {
    expect(meetsAA(T.gold, T.surface)).toBe(false);
    expect(contrastRatio(T.gold, T.surface)).toBeGreaterThanOrEqual(WCAG_AA_LARGE_TEXT * 0.4); // sanity: not absurdly low
  });

  it("documents that --flame text alone fails AA normal text (used as accent, not foreground text)", () => {
    expect(meetsAA(T.flame, T.surface)).toBe(false);
  });

  it("documents that --gold-700 text alone fails AA normal text (large/bold only)", () => {
    expect(meetsAA(T.gold700, T.surface)).toBe(false);
  });

  // Why the semantic status tokens exist at all. Before them, every app
  // reached for a family color when it wanted a status color: --f-raval as
  // "error red" (~20 uses) and an untokenized green as "success" (~11). The
  // family ramp was never built to carry status, and --f-petro proves it —
  // it drops under 4.5:1 on the warm recess that panels sit on.
  it("documents that --f-petro fails AA as text on --bg-warm, so status has its own tokens", () => {
    expect(meetsAA(T.fPetro, T.bgWarm)).toBe(false);
    expect(meetsAA(T.warn, T.bgWarm)).toBe(true);
  });

  it("keeps each status foreground distinct from the family color it used to be confused with", () => {
    expect(T.danger).not.toBe(T.fRaval);
    expect(T.warn).not.toBe(T.fPetro);
  });
});

function listCssFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listCssFiles(full));
    else if (entry.name.endsWith(".css") && !entry.name.startsWith("tokens.generated")) out.push(full);
  }
  return out;
}

describe("TC-PC08-003 touch targets >= 44px and a visible focus ring exist", () => {
  it("every declared interactive min/inline/block-size in packages/ui is >= 44px", () => {
    const componentsDir = path.join(repoRoot, "packages/ui/src/components");
    const undersized: string[] = [];
    for (const file of listCssFiles(componentsDir)) {
      const content = readFileSync(file, "utf8");
      const regex = /\b(min-inline-size|min-block-size|inline-size|block-size):\s*(\d+)px/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(content))) {
        const px = Number(m[2]);
        // Only flag sizes declared on what are clearly whole tap-target
        // boxes (>=20px) — hairline decorative bars (e.g. a 2px menu-icon
        // stroke) aren't targets themselves and sit well under this floor.
        if (px >= 20 && px < 44) {
          undersized.push(`${path.relative(repoRoot, file)}: ${m[1]}: ${px}px`);
        }
      }
    }
    expect(undersized).toEqual([]);
  });

  it("packages/ui/src/tokens/base.css defines a visible :focus-visible ring using tokens", () => {
    const base = readFileSync(path.join(repoRoot, "packages/ui/src/tokens/base.css"), "utf8");
    expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--blue-600\)/);
  });
});
