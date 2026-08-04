import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Skeleton } from "./Skeleton";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("Skeleton", () => {
  it("is hidden from assistive tech — the loading region announces once, not per bar", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("takes its width from an enum, so app code never needs an inline style", () => {
    const { container } = render(<Skeleton width="3/4" />);
    expect(container.firstElementChild).toHaveClass("ps-skeleton--w-3-4");
  });

  it("drops the width class for a circle, which is sized by its own rule", () => {
    const { container } = render(<Skeleton variant="circle" width="1/2" />);
    expect(container.firstElementChild).not.toHaveClass("ps-skeleton--w-1-2");
    expect(container.firstElementChild).toHaveClass("ps-skeleton--circle");
  });

  it("sizes a block placeholder, and only a block placeholder", () => {
    const { container: block } = render(<Skeleton variant="block" size="lg" />);
    expect(block.firstElementChild).toHaveClass("ps-skeleton--lg");
    cleanup();
    const { container: line } = render(<Skeleton variant="line" size="lg" />);
    expect(line.firstElementChild).not.toHaveClass("ps-skeleton--lg");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = () => <Skeleton variant="block" width="1/2" size="sm" />;
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
