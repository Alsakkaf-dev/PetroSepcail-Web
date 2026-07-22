import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EmptyState } from "./EmptyState";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders title, description and action", () => {
    render(<EmptyState title="No orders yet" description="Once you order, it shows here." action={<button>Shop</button>} />);
    expect(screen.getByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByText("Once you order, it shows here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shop" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = (locale: "ar" | "en") => (
      <EmptyState title={locale === "ar" ? "لا يوجد" : "None"} description={locale === "ar" ? "وصف" : "Desc"} />
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
