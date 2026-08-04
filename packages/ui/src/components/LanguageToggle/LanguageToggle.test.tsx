import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LanguageToggle } from "./LanguageToggle";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

const ariaLabel = { ar: "تبديل اللغة", en: "Switch language" };

describe("LanguageToggle", () => {
  it("shows the target language label while in Arabic", () => {
    render(<LanguageToggle locale="ar" onToggle={() => {}} ariaLabel={ariaLabel} />);
    expect(screen.getByRole("button")).toHaveTextContent("EN");
  });

  it("shows the target language label while in English", () => {
    render(<LanguageToggle locale="en" onToggle={() => {}} ariaLabel={ariaLabel} />);
    expect(screen.getByRole("button")).toHaveTextContent("عربي");
  });

  it("carries the site's globe mark, decoratively — the button is already named", () => {
    const { container } = render(<LanguageToggle locale="ar" onToggle={() => {}} ariaLabel={ariaLabel} />);
    const icon = container.querySelector("svg");
    expect(icon).toHaveClass("ps-icon");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button")).toHaveAccessibleName(ariaLabel.ar);
  });

  it("calls onToggle with the other locale", () => {
    const onToggle = vi.fn();
    render(<LanguageToggle locale="ar" onToggle={onToggle} ariaLabel={ariaLabel} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledWith("en");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const rtlSignature = withDocumentDirection("rtl", "ar", () => {
      const { container } = render(<LanguageToggle locale="ar" onToggle={() => {}} ariaLabel={ariaLabel} />);
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    const ltrSignature = withDocumentDirection("ltr", "en", () => {
      const { container } = render(<LanguageToggle locale="en" onToggle={() => {}} ariaLabel={ariaLabel} />);
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    expect(ltrSignature).toEqual(rtlSignature);
  });
});
