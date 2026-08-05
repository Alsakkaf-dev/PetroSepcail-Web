import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Bar, Sparkline, TrendChart } from "./Chart";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

function parity(build: () => JSX.Element) {
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
}

describe("Bar", () => {
  it("clamps a share outside 0..1 rather than overflowing its track", () => {
    const { container } = render(<Bar share={1.8} />);
    expect(container.querySelector(".ps-bar__fill")).toHaveStyle({ inlineSize: "100%" });
    cleanup();
    const negative = render(<Bar share={-3} />);
    expect(negative.container.querySelector(".ps-bar__fill")).toHaveStyle({ inlineSize: "0%" });
  });

  it("stays out of the accessibility tree — the figure beside it is the content", () => {
    const { container } = render(<Bar share={0.4} />);
    expect(container.querySelector(".ps-bar")).toHaveAttribute("aria-hidden", "true");
  });
});

const POINTS = [
  { label: "1 أغسطس", share: 0.4, value: "1,200.00 ر.س" },
  { label: "2 أغسطس", share: 1, value: "3,000.00 ر.س" }
];

describe("TrendChart", () => {
  it("is a table, so every figure survives a screen reader and a find-in-page", () => {
    render(<TrendChart label="المبيعات اليومية" points={POINTS} />);
    const table = screen.getByRole("table", { name: "المبيعات اليومية" });
    expect(table).toBeInTheDocument();
    expect(screen.getByText("3,000.00 ر.س")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "1 أغسطس" })).toBeInTheDocument();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <TrendChart label="l" points={POINTS} columns={{ label: "a", value: "b" }} />);
  });
});

describe("Sparkline", () => {
  it("draws one bar per point", () => {
    const { container } = render(<Sparkline label="اتجاه" points={[1, 4, 2, 8]} />);
    expect(container.querySelectorAll(".ps-sparkline__bar")).toHaveLength(4);
  });

  it("says nothing to a screen reader — a shape with no axes has nothing to say", () => {
    const { container } = render(<Sparkline label="اتجاه" points={[1, 2]} />);
    expect(container.querySelector(".ps-sparkline")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".ps-sparkline")).toHaveAttribute("title", "اتجاه");
  });

  it("survives an all-zero series without dividing by zero", () => {
    const { container } = render(<Sparkline label="l" points={[0, 0, 0]} />);
    expect(container.querySelectorAll(".ps-sparkline__bar")).toHaveLength(3);
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <Sparkline label="l" points={[1, 2, 3]} />);
  });
});
