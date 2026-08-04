import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LoadingState } from "./LoadingState";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("LoadingState", () => {
  it("renders the requested number of skeleton lines as a live region", () => {
    render(<LoadingState lines={4} label="Loading orders" />);
    const region = screen.getByRole("status", { name: "Loading orders" });
    expect(region.children).toHaveLength(4);
  });

  it("defaults to 3 lines", () => {
    render(<LoadingState />);
    expect(screen.getByRole("status").children).toHaveLength(3);
  });

  it("hides the bars themselves, so the region is announced once", () => {
    render(<LoadingState lines={3} />);
    for (const bar of Array.from(screen.getByRole("status").children)) {
      expect(bar).toHaveClass("ps-skeleton");
      expect(bar).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("shortens the last line so a block of bars reads as prose", () => {
    render(<LoadingState lines={3} />);
    const bars = Array.from(screen.getByRole("status").children);
    expect(bars[0]).toHaveClass("ps-skeleton--w-full");
    expect(bars[2]).toHaveClass("ps-skeleton--w-1-2");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const rtlSignature = withDocumentDirection("rtl", "ar", () => {
      const { container } = render(<LoadingState lines={2} label="جارٍ التحميل" />);
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    const ltrSignature = withDocumentDirection("ltr", "en", () => {
      const { container } = render(<LoadingState lines={2} label="Loading" />);
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    expect(ltrSignature).toEqual(rtlSignature);
  });
});
