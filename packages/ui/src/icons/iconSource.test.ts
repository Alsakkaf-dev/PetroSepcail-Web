// Source-text gates for the icon folder. Deliberately a `.test.ts` and not a
// `.test.tsx`: scripts/parity-grep.mjs exempts `*.test.ts` only, so the URL
// pattern asserted below can be written literally here and nowhere else.
// Node environment (no jsdom) — this file reads files, it never renders.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const iconsDir = path.dirname(fileURLToPath(import.meta.url));
// The test files themselves are excluded: this one names both banned patterns
// in order to assert against them, and would otherwise flag itself.
const sourceFiles = readdirSync(iconsDir).filter(
  (f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test.")
);

describe("icon source constraints (the two that fail the build, not the eye)", () => {
  it("carries no xmlns attribute and no URL in any icon source file", () => {
    for (const file of sourceFiles) {
      const source = readFileSync(path.join(iconsDir, file), "utf8");
      // An SVG namespace URI is a URL, and parity-grep fails the build on any
      // URL in application source. React renders inline SVG correctly without
      // it inside an HTML document.
      // The attribute form specifically — the folder's own comments name the
      // banned attribute in prose, which is the point of documenting it.
      expect(source, file).not.toMatch(/xmlns\s*[=:]/);
      expect(source, file).not.toMatch(/https?:\/\//i);
    }
  });

  it("sizes every icon in em, never px", () => {
    const css = readFileSync(path.join(iconsDir, "Icon.css"), "utf8");
    const sizeRules = css.match(/\.ps-icon--(?:sm|md|lg|xl)\s*\{[^}]*\}/g) ?? [];
    expect(sizeRules).toHaveLength(4);
    for (const rule of sizeRules) {
      // a11y/contrast.test.ts fails any declared box between 20px and 43px as
      // an undersized touch target; em sizing keeps icons out of that rule's
      // way entirely, and a tap target is built by the control around the
      // icon rather than by the glyph.
      expect(rule).not.toMatch(/\d+px/);
      expect(rule).toMatch(/em;/);
    }
  });

  it("mirrors directional glyphs in CSS rather than by swapping artwork", () => {
    const css = readFileSync(path.join(iconsDir, "Icon.css"), "utf8");
    expect(css).toMatch(/\[dir="rtl"\]\s*\.ps-icon--directional\s*\{\s*transform:\s*scaleX\(-1\)/);
  });

  it("uses the --r-drop token for the icon well rather than a literal radius", () => {
    const css = readFileSync(path.join(iconsDir, "Icon.css"), "utf8");
    expect(css).toMatch(/\.ps-icon-well\s*\{[^}]*border-radius:\s*var\(--r-drop\)/);
  });

  it("ships the ISC licence next to the vendored artwork", () => {
    const licence = readFileSync(path.join(iconsDir, "LICENSE-lucide.txt"), "utf8");
    expect(licence).toMatch(/ISC License/);
    expect(licence).toMatch(/Lucide/);
  });
});
