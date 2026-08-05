import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LineItem, LineList, LineNote } from "./LineItem";
import { SummaryPanel } from "./SummaryPanel";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("LineList / LineItem", () => {
  it("is a real list, named, so a reader hears how many products are in it", () => {
    render(
      <LineList label="سلة التسوق">
        <LineItem title="سوبر سبيشل 10W-30" />
        <LineItem title="رافال 5W-30" />
      </LineList>
    );
    expect(screen.getByRole("list", { name: "سلة التسوق" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("drops every slot it was given nothing for", () => {
    const { container } = render(<LineItem title="سوبر سبيشل" />);
    expect(container.querySelector(".ps-line__media")).toBeNull();
    expect(container.querySelector(".ps-line__control")).toBeNull();
    expect(container.querySelector(".ps-line__price")).toBeNull();
    expect(container.querySelector(".ps-line__action")).toBeNull();
  });

  it("renders each slot it was given", () => {
    const { container } = render(
      <LineItem
        title="سوبر سبيشل"
        meta="1 لتر"
        media={<img alt="" src="/p.webp" />}
        control={<button type="button">+</button>}
        price={<span>25.30 ر.س</span>}
        action={<button type="button">إزالة</button>}
        notes={<LineNote tone="danger">غير متوفر حالياً</LineNote>}
      />
    );
    expect(container.querySelector(".ps-line__media")).not.toBeNull();
    expect(container.querySelector(".ps-line__control")).not.toBeNull();
    expect(container.querySelector(".ps-line__price")).not.toBeNull();
    expect(container.querySelector(".ps-line__action")).not.toBeNull();
    expect(screen.getByText("غير متوفر حالياً")).toBeInTheDocument();
  });

  it("marks an unavailable line without hiding the words that say why", () => {
    const { container } = render(
      <LineItem muted title="سوبر سبيشل" notes={<LineNote tone="danger">غير متوفر حالياً</LineNote>} />
    );
    expect(container.querySelector(".ps-line")).toHaveClass("ps-line--muted");
    expect(screen.getByText("غير متوفر حالياً")).toBeVisible();
  });

  it("renders the same tree in both directions", () => {
    const line = (
      <LineList label="l">
        <LineItem
          title="t"
          meta="m"
          media={<i />}
          control={<button type="button">c</button>}
          price={<span>p</span>}
          action={<button type="button">a</button>}
          notes={<LineNote tone="warn">n</LineNote>}
        />
      </LineList>
    );
    const rtl = withDocumentDirection("rtl", "ar", () => structuralSignature(render(line).container));
    cleanup();
    const ltr = withDocumentDirection("ltr", "en", () => structuralSignature(render(line).container));
    expect(rtl).toEqual(ltr);
  });
});

const ROWS = [
  { id: "subtotal", label: "المجموع الفرعي", value: "100.00 ر.س" },
  { id: "vat", label: "ضريبة القيمة المضافة", value: "15.00 ر.س", emphasis: "muted" as const },
  { id: "discount", label: "الخصم", value: "-10.00 ر.س", emphasis: "credit" as const },
  { id: "total", label: "الإجمالي", value: "105.00 ر.س", emphasis: "total" as const }
];

describe("SummaryPanel", () => {
  it("pairs every figure with its own label, which a run of spans does not", () => {
    render(<SummaryPanel label="ملخص الطلب" rows={ROWS} />);
    const group = screen.getByRole("group", { name: "ملخص الطلب" });
    expect(group.querySelectorAll("dt")).toHaveLength(4);
    expect(group.querySelectorAll("dd")).toHaveLength(4);
  });

  it("carries a credit line's sign in the value, not only in its colour", () => {
    render(<SummaryPanel label="s" rows={ROWS} />);
    expect(screen.getByText("-10.00 ر.س")).toBeInTheDocument();
  });

  it("marks the total row so the eye and the stylesheet agree on which one it is", () => {
    const { container } = render(<SummaryPanel label="s" rows={ROWS} />);
    expect(container.querySelector(".ps-summary__row--total")).toHaveTextContent("الإجمالي");
  });

  it("renders whatever closes the panel off — a progress bar, a note, the button", () => {
    render(
      <SummaryPanel label="s" rows={ROWS}>
        <button type="button">إتمام الشراء</button>
      </SummaryPanel>
    );
    expect(screen.getByRole("button", { name: "إتمام الشراء" })).toBeInTheDocument();
  });

  it("renders the same tree in both directions", () => {
    const panel = (
      <SummaryPanel label="s" rows={ROWS}>
        <span>f</span>
      </SummaryPanel>
    );
    const rtl = withDocumentDirection("rtl", "ar", () => structuralSignature(render(panel).container));
    cleanup();
    const ltr = withDocumentDirection("ltr", "en", () => structuralSignature(render(panel).container));
    expect(rtl).toEqual(ltr);
  });
});
