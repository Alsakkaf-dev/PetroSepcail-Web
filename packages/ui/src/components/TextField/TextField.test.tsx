import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TextField } from "./TextField";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("TextField", () => {
  it("associates the label and renders a hint", () => {
    render(<TextField label="Email" hint="We never share it" />);
    const input = screen.getByLabelText("Email");
    expect(input).toBeInTheDocument();
    expect(screen.getByText("We never share it")).toHaveAttribute("id", input.getAttribute("aria-describedby"));
  });

  it("marks aria-invalid and shows the error instead of the hint", () => {
    render(<TextField label="Email" hint="hidden while invalid" error="IDENTITY_EXISTS" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("IDENTITY_EXISTS");
    expect(screen.queryByText("hidden while invalid")).not.toBeInTheDocument();
  });

  it("applies the LTR-force class for phone/email-style fields", () => {
    render(<TextField label="Phone" forceLtr />);
    expect(screen.getByLabelText("Phone")).toHaveClass("ps-ltr");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = (locale: "ar" | "en") => (
      <TextField label={locale === "ar" ? "البريد الإلكتروني" : "Email"} error={locale === "ar" ? "خطأ" : "Error"} forceLtr />
    );
    const rtlSignature = withDocumentDirection("rtl", "ar", () => {
      const { container } = render(build("ar"));
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    const ltrSignature = withDocumentDirection("ltr", "en", () => {
      const { container } = render(build("en"));
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    expect(ltrSignature).toEqual(rtlSignature);
  });
});
