import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProductThumb } from "./ProductThumb";
import { ProductCard } from "./ProductCard";
import { FamilyCard } from "./FamilyCard";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("ProductThumb", () => {
  it("shows the photograph when there is one", () => {
    render(<ProductThumb src="/p.webp" alt="سوبر سبيشل" family="special" grade="10W-30" />);
    expect(screen.getByAltText("سوبر سبيشل")).toHaveAttribute("src", "/p.webp");
  });

  it("falls back to the family/grade placeholder the catalogue seed specifies", () => {
    const { container } = render(<ProductThumb alt="رافال" family="raval" grade="5W-30" />);
    expect(container.querySelector(".ps-thumb--placeholder")).toHaveClass("ps-thumb--raval");
    expect(container.querySelector(".ps-thumb__grade")).toHaveTextContent("5W-30");
  });

  it("keeps the placeholder out of the accessibility tree — the card says all of it in text", () => {
    const { container } = render(<ProductThumb alt="رافال" family="raval" grade="5W-30" />);
    expect(container.querySelector(".ps-thumb")).toHaveAttribute("aria-hidden", "true");
  });

  it("isolates the grade, which is Latin inside Arabic copy", () => {
    const { container } = render(<ProductThumb alt="x" family="petro" grade="20W-50" />);
    expect(container.querySelector(".ps-thumb__grade")).toHaveClass("ps-ltr");
  });
});

const CARD = {
  href: "/catalog/raval-5w30",
  name: "رافال 5W-30",
  family: "raval" as const,
  familyLabel: "رافال",
  grade: "5W-30",
  price: <span>25.30 ر.س</span>
};

describe("ProductCard", () => {
  it("exposes exactly one link, named by the product", () => {
    render(<ProductCard {...CARD} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "رافال 5W-30" })).toHaveAttribute("href", "/catalog/raval-5w30");
  });

  it("names the family in words, never in colour alone", () => {
    render(<ProductCard {...CARD} />);
    expect(screen.getByText("رافال")).toBeInTheDocument();
  });

  it("keeps actions reachable on an out-of-stock SKU — buying is off, the wishlist is not", () => {
    render(
      <ProductCard
        {...CARD}
        inStock={false}
        actions={
          <>
            <button type="button" disabled>
              أضف إلى السلة
            </button>
            <button type="button">قائمة الرغبات</button>
          </>
        }
      />
    );
    expect(screen.getByRole("button", { name: "أضف إلى السلة" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "قائمة الرغبات" })).toBeEnabled();
  });

  it("marks the out-of-stock tile so the price can be greyed", () => {
    const { container } = render(<ProductCard {...CARD} inStock={false} />);
    expect(container.querySelector(".ps-product")).toHaveClass("ps-product--out");
  });
});

describe("FamilyCard", () => {
  it("carries the family's own introduction and its SKU count", () => {
    render(
      <FamilyCard
        href="/catalog?family=petro"
        family="petro"
        name="بتروتوريون"
        intro="عائلة بتروتوريون"
        skuCount="9"
        skuCountLabel="منتج"
      />
    );
    const link = screen.getByRole("link", { name: /بتروتوريون/ });
    expect(link).toHaveAttribute("href", "/catalog?family=petro");
    expect(link).toHaveTextContent("عائلة بتروتوريون");
    expect(link).toHaveTextContent("9");
  });
});

describe("structural parity (TC-PC08-002)", () => {
  const cases: Array<[string, () => JSX.Element]> = [
    ["ProductThumb placeholder", () => <ProductThumb alt="x" family="special" grade="10W-30" />],
    ["ProductThumb photo", () => <ProductThumb src="/p.webp" alt="x" family="special" grade="10W-30" />],
    ["ProductCard", () => <ProductCard {...CARD} stock={<span>متوفر</span>} actions={<button type="button">أ</button>} />],
    [
      "FamilyCard",
      () => (
        <FamilyCard href="/c" family="special" name="سبيشل" intro="مقدمة" skuCount="11" skuCountLabel="منتج" />
      )
    ]
  ];

  it.each(cases)("%s renders an identical tree in both directions", (_name, node) => {
    const rtl = withDocumentDirection("rtl", "ar", () => {
      const { container } = render(node());
      const sig = structuralSignature(container.firstElementChild!);
      cleanup();
      return sig;
    });
    const ltr = withDocumentDirection("ltr", "en", () => {
      const { container } = render(node());
      const sig = structuralSignature(container.firstElementChild!);
      cleanup();
      return sig;
    });
    expect(rtl).toEqual(ltr);
  });
});
