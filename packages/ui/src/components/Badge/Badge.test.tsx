import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Badge } from "./Badge";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("Badge", () => {
  it("renders children and defaults to the neutral variant", () => {
    render(<Badge>Pending</Badge>);
    const el = screen.getByText("Pending");
    expect(el).toHaveClass("ps-badge", "ps-badge--neutral");
  });

  it.each(["neutral", "gold", "blue", "flame"] as const)("renders the %s variant class", (variant) => {
    render(<Badge variant={variant}>x</Badge>);
    expect(screen.getByText("x")).toHaveClass(`ps-badge--${variant}`);
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const rtlSignature = withDocumentDirection("rtl", "ar", () => {
      const { container } = render(<Badge variant="gold">شارة</Badge>);
      const signature = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return signature;
    });

    const ltrSignature = withDocumentDirection("ltr", "en", () => {
      const { container } = render(<Badge variant="gold">Badge</Badge>);
      const signature = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return signature;
    });

    expect(ltrSignature).toEqual(rtlSignature);
  });
});
