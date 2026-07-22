import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Button } from "./Button";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("Button", () => {
  it("renders as a native button with the gold variant by default", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveClass("ps-btn--gold", "ps-btn--md");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disables and marks aria-busy when busy, and blocks clicks", () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Saving
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Saving" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const rtlSignature = withDocumentDirection("rtl", "ar", () => {
      const { container } = render(<Button variant="danger">حذف</Button>);
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    const ltrSignature = withDocumentDirection("ltr", "en", () => {
      const { container } = render(<Button variant="danger">Delete</Button>);
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    expect(ltrSignature).toEqual(rtlSignature);
  });
});
