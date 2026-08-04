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

  it("marks aria-invalid and keeps the hint beside the error", () => {
    // The hint used to be hidden whenever an error was present. It is exactly
    // the moment the hint is most useful — it says what the field wants,
    // while the error says what was wrong with what arrived.
    render(<TextField label="Email" hint="Use your work address" error="IDENTITY_EXISTS" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("IDENTITY_EXISTS");
    expect(screen.getByText("Use your work address")).toBeInTheDocument();
    expect(input.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
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
