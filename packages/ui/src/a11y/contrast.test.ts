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
  muted: "#6b7280",
  bg: "#fdfcf9",
  surface: "#ffffff",
  bgTint: "#fff8e1",
  blue: "#16265c",
  blue600: "#1e3a8a",
  gold: "#ffc800",
  gold700: "#a37f00",
  flame: "#f15a24"
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
    ["ink on bg-tint (toast/info surfaces)", T.ink, T.bgTint]
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
