import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Reveal, Stagger } from "./Reveal";
import { CountUp } from "./CountUp";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

/** jsdom implements neither matchMedia nor IntersectionObserver. Both are
 * stubbed per test so the reduced-motion path and the animating path can each
 * be exercised deliberately. */
function stubMotionEnvironment({ reduced }: { reduced: boolean }) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
      }
      disconnect() {}
      unobserve() {}
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Reveal", () => {
  it("shows its content as soon as it enters the viewport", () => {
    stubMotionEnvironment({ reduced: false });
    const { container } = render(<Reveal>card</Reveal>);
    expect(container.firstElementChild).toHaveClass("ps-reveal--in");
    expect(screen.getByText("card")).toBeInTheDocument();
  });

  it("is visible at rest under reduced motion, never stuck part-way in", () => {
    stubMotionEnvironment({ reduced: true });
    const { container } = render(<Reveal variant="left">card</Reveal>);
    expect(container.firstElementChild).toHaveClass("ps-reveal--in");
  });

  it("carries no transition delay under reduced motion", () => {
    stubMotionEnvironment({ reduced: true });
    const { container } = render(<Reveal delay={0.5}>card</Reveal>);
    expect(container.firstElementChild).not.toHaveStyle({ transitionDelay: "0.5s" });
  });

  it("sets the delay inside packages/ui, which is what keeps apps inline-style free", () => {
    stubMotionEnvironment({ reduced: false });
    const { container } = render(<Reveal delay={0.36}>card</Reveal>);
    expect(container.firstElementChild).toHaveStyle({ transitionDelay: "0.36s" });
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    stubMotionEnvironment({ reduced: false });
    const build = () => <Reveal variant="right">x</Reveal>;
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

describe("Stagger", () => {
  it("gives each child a growing delay rather than writing them after mount", () => {
    stubMotionEnvironment({ reduced: false });
    const { container } = render(
      <Stagger step={0.1}>
        <span>a</span>
        <span>b</span>
        <span>c</span>
      </Stagger>
    );
    const reveals = container.querySelectorAll(".ps-reveal");
    expect(reveals).toHaveLength(3);
    expect(reveals[1]).toHaveStyle({ transitionDelay: "0.1s" });
    expect(reveals[2]).toHaveStyle({ transitionDelay: "0.2s" });
  });
});

describe("CountUp", () => {
  it("writes the final value immediately under reduced motion", () => {
    stubMotionEnvironment({ reduced: true });
    render(<CountUp value={1250} format={(n) => Math.round(n).toString()} />);
    expect(screen.getByText("1250")).toBeInTheDocument();
  });

  it("keeps the intermediate frames out of the accessibility tree", () => {
    stubMotionEnvironment({ reduced: true });
    const { container } = render(<CountUp value={10} format={(n) => Math.round(n).toString()} />);
    // A screen reader must hear the final figure, not sixty on the way to it.
    expect(container.firstElementChild).toHaveAttribute("aria-live", "off");
  });

  it("formats through the caller's formatter, so digits match the page", () => {
    stubMotionEnvironment({ reduced: true });
    render(<CountUp value={1250} format={(n) => `SAR ${Math.round(n).toLocaleString("en-US")}`} />);
    expect(screen.getByText("SAR 1,250")).toBeInTheDocument();
  });
});
