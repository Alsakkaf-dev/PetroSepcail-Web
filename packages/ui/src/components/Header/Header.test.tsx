import { describe, expect, it, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Header } from "./Header";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

const navItems = [
  { label: "Home", href: "/", current: true },
  { label: "Products", href: "/products" }
];

describe("Header", () => {
  it("renders logo, nav links and marks the current page", () => {
    render(<Header logo="PetroSpecial" navItems={navItems} />);
    expect(screen.getByText("PetroSpecial")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Products" })).not.toHaveAttribute("aria-current");
  });

  it("toggles the mobile menu and updates aria-expanded", () => {
    render(<Header logo="PS" navItems={navItems} menuLabel="Menu" closeMenuLabel="Close" />);
    const toggle = screen.getByRole("button", { name: "Menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = (locale: "ar" | "en") => (
      <Header
        logo="PS"
        navItems={[{ label: locale === "ar" ? "الرئيسية" : "Home", href: "/", current: true }]}
        menuLabel={locale === "ar" ? "القائمة" : "Menu"}
      />
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
