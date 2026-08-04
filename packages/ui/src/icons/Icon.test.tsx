import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Icon, IconWell } from "./Icon";
import { DIRECTIONAL, ICON_NAMES, glyphs } from "./glyphs";
import { structuralSignature, withDocumentDirection } from "../testing/domSnapshot";

// Everything that inspects the *source text* of this folder (no xmlns, no
// URL, em-only sizing) lives in iconSource.test.ts instead. parity-grep
// exempts `*.test.ts` but not `*.test.tsx`, so a URL pattern written here as
// a regex would itself fail the build.

afterEach(cleanup);

describe("Icon", () => {
  it("is decorative and hidden from assistive tech by default", () => {
    const { container } = render(<Icon name="cart" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
  });

  it("is announced as an image when it carries the meaning itself", () => {
    render(<Icon name="cart" label="سلة التسوق" />);
    const svg = screen.getByRole("img", { name: "سلة التسوق" });
    expect(svg).not.toHaveAttribute("aria-hidden");
  });

  it("carries the house stroke weight rather than each glyph's own", () => {
    const { container } = render(<Icon name="droplet" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "1.8");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    // Never focusable in IE/Edge legacy tab order, and never a tab stop.
    expect(svg).toHaveAttribute("focusable", "false");
  });

  it("takes its size from the em scale", () => {
    const { container } = render(<Icon name="cart" size="lg" />);
    expect(container.querySelector("svg")).toHaveClass("ps-icon", "ps-icon--lg");
  });

  it("marks only reading-axis glyphs as mirroring", () => {
    const { container: forward } = render(<Icon name="arrow-forward" />);
    expect(forward.querySelector("svg")).toHaveClass("ps-icon--directional");
    cleanup();
    const { container: clock } = render(<Icon name="clock" />);
    expect(clock.querySelector("svg")).not.toHaveClass("ps-icon--directional");
    // A clock, a map pin or a product mark that mirrors is a bug, not
    // localisation.
    for (const name of ["clock", "map-pin", "droplet", "shield", "star"] as const) {
      expect(DIRECTIONAL.has(name)).toBe(false);
    }
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = () => (
      <span>
        <Icon name="arrow-forward" />
        <Icon name="clock" label="clock" />
        <IconWell name="droplet" tone="blue" />
      </span>
    );
    const rtl = withDocumentDirection("rtl", "ar", () => {
      const { container } = render(build());
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    const ltr = withDocumentDirection("ltr", "en", () => {
      const { container } = render(build());
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    expect(ltr).toEqual(rtl);
  });
});

describe("the vendored glyph set", () => {
  it("exposes every glyph through ICON_NAMES, with no duplicates", () => {
    expect(ICON_NAMES).toHaveLength(Object.keys(glyphs).length);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it("renders every glyph with at least one geometry element", () => {
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector("svg")?.childElementCount).toBeGreaterThan(0);
      cleanup();
    }
  });
});

describe("IconWell", () => {
  it("wraps the glyph in the oil-drop shape with a tone", () => {
    const { container } = render(<IconWell name="droplet" tone="success" />);
    const well = container.firstElementChild;
    expect(well).toHaveClass("ps-icon-well", "ps-icon-well--success", "ps-icon-well--md");
    expect(well?.querySelector("svg")).toHaveClass("ps-icon--xl");
  });
});
