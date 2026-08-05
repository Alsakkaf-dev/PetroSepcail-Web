import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LineItem, LineList, LineNote } from "./LineItem";
import { SummaryPanel } from "./SummaryPanel";
import { StopCard, StopSection } from "./StopCard";
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

describe("StopCard / StopSection", () => {
  it("names the stop type in words, never in colour alone", () => {
    render(
      <StopSection title="توريد للموزّعين" kind="b2b_drop" count="3">
        <StopCard kind="b2b_drop" kindLabel="توريد للموزّعين" destination="مؤسسة النور" />
      </StopSection>
    );
    expect(screen.getByRole("region", { name: "توريد للموزّعين" })).toBeInTheDocument();
    expect(screen.getAllByText("توريد للموزّعين").length).toBeGreaterThan(0);
  });

  it("keeps the three types in separate sections", () => {
    const { container } = render(
      <>
        <StopSection title="a" kind="b2b_drop">
          <StopCard kind="b2b_drop" kindLabel="a" destination="d1" />
        </StopSection>
        <StopSection title="b" kind="b2c_home">
          <StopCard kind="b2c_home" kindLabel="b" destination="d2" />
        </StopSection>
        <StopSection title="c" kind="b2c_pickup">
          <StopCard kind="b2c_pickup" kindLabel="c" destination="d3" />
        </StopSection>
      </>
    );
    expect(container.querySelectorAll(".ps-stop-section")).toHaveLength(3);
    expect(container.querySelector(".ps-stop-section--b2b_drop")).not.toBeNull();
    expect(container.querySelector(".ps-stop-section--b2c_home")).not.toBeNull();
    expect(container.querySelector(".ps-stop-section--b2c_pickup")).not.toBeNull();
  });

  it("renders item counts and drops the facts row when there is nothing to put in it", () => {
    const { container, rerender } = render(
      <StopSection title="s" kind="b2c_home">
        <StopCard kind="b2c_home" kindLabel="k" destination="d" items="3 أصناف" />
      </StopSection>
    );
    expect(screen.getByText("3 أصناف")).toBeInTheDocument();
    rerender(
      <StopSection title="s" kind="b2c_home">
        <StopCard kind="b2c_home" kindLabel="k" destination="d" />
      </StopSection>
    );
    expect(container.querySelector(".ps-stop__facts")).toBeNull();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const tree = (
      <StopSection title="s" kind="b2b_drop" count="2">
        <StopCard
          kind="b2b_drop"
          kindLabel="k"
          destination="d"
          status={<span>st</span>}
          sequence="1"
          eta={<time>10:00</time>}
          items="2"
          action={<button type="button">go</button>}
        />
      </StopSection>
    );
    const rtl = withDocumentDirection("rtl", "ar", () => structuralSignature(render(tree).container));
    cleanup();
    const ltr = withDocumentDirection("ltr", "en", () => structuralSignature(render(tree).container));
    expect(rtl).toEqual(ltr);
  });
});
