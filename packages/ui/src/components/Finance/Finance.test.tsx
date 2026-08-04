import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FinancePanel } from "./FinancePanel";
import { CreditHeadroom } from "./CreditHeadroom";
import { AgingBars } from "./AgingBars";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

function parity(build: () => JSX.Element) {
  const rtl = withDocumentDirection("rtl", "ar", () => {
    const { container } = render(build());
    const sig = structuralSignature(container.firstElementChild as Element);
    cleanup();
    return sig;
  });
  const ltr = withDocumentDirection("ltr", "en", () => {
    const { container } = render(build());
    const sig = structuralSignature(container.firstElementChild as Element);
    cleanup();
    return sig;
  });
  expect(ltr).toEqual(rtl);
}

describe("FinancePanel (D-14 rule f)", () => {
  it("gives each surface its own region, heading and kind marker", () => {
    const { container } = render(
      <>
        <FinancePanel kind="debt" title="الذمم المدينة" subtitle="ما عليك" titleId="debt">
          <p>1</p>
        </FinancePanel>
        <FinancePanel
          kind="custody-funds"
          title="الأمانة النقدية"
          titleId="custody"
          separationNote="ليست جزءاً مما عليك"
        >
          <p>2</p>
        </FinancePanel>
        <FinancePanel kind="goods-custody" title="طرود بالأمانة" titleId="goods" separationNote="ليست ديناً">
          <p>3</p>
        </FinancePanel>
      </>
    );
    const kinds = [...container.querySelectorAll("[data-finance-kind]")].map((el) =>
      el.getAttribute("data-finance-kind")
    );
    expect(kinds).toEqual(["debt", "custody-funds", "goods-custody"]);
    // Three separately-named regions, so assistive tech can never present
    // them as one figure.
    expect(screen.getByRole("region", { name: "الذمم المدينة" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "الأمانة النقدية" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "طرود بالأمانة" })).toBeInTheDocument();
  });

  it("always renders a custody panel's separation note", () => {
    render(
      <FinancePanel kind="custody-funds" title="الأمانة النقدية" separationNote="ليست جزءاً مما عليك">
        <p>x</p>
      </FinancePanel>
    );
    // Required by the prop types, not by convention — a custody panel cannot
    // be constructed without it.
    expect(screen.getByText("ليست جزءاً مما عليك")).toBeInTheDocument();
  });

  it("does not put a separation note on the debt panel, which is what you do owe", () => {
    const { container } = render(
      <FinancePanel kind="debt" title="الذمم">
        <p>x</p>
      </FinancePanel>
    );
    expect(container.querySelector(".ps-finance__separation")).toBeNull();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <FinancePanel kind="custody-funds" title="t" subtitle="s" separationNote="n" actions={<button type="button">a</button>}>
        <p>x</p>
      </FinancePanel>
    ));
  });
});

describe("CreditHeadroom", () => {
  const labels = { limit: "الحد", exposure: "المستخدم", headroom: "المتاح", usage: "استخدام الحد" };

  it("shows the three figures the server computed", () => {
    render(
      <CreditHeadroom
        limit="20,000.00"
        exposure="12,500.00"
        headroom="7,500.00"
        labels={labels}
        usedRatio={0.625}
      />
    );
    expect(screen.getByText("7,500.00")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "استخدام الحد" })).toHaveAttribute("aria-valuenow", "62.5");
  });

  it("states the block with its shortfall rather than just refusing", () => {
    render(
      <CreditHeadroom
        limit="20,000.00"
        exposure="21,000.00"
        headroom="0.00"
        labels={labels}
        usedRatio={1.2}
        exceeded={{ message: "تجاوزت حد الائتمان", shortfallLabel: "النقص:", shortfall: "1,000.00" }}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("تجاوزت حد الائتمان");
    expect(alert).toHaveTextContent("1,000.00");
    // The bar is clamped rather than overflowing its track.
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <CreditHeadroom
        limit="1"
        exposure="2"
        headroom="3"
        labels={labels}
        usedRatio={0.5}
        exceeded={{ message: "m", shortfallLabel: "s", shortfall: "4" }}
      />
    ));
  });
});

describe("AgingBars", () => {
  it("is readable as a list of amounts, not only as a picture", () => {
    const { container } = render(
      <AgingBars
        label="أعمار الذمم"
        buckets={[
          { label: "0-30", amount: "5,000.00", share: 0.5 },
          { label: "90+", amount: "1,000.00", share: 0.1 }
        ]}
      />
    );
    // A canvas chart would put these amounts out of reach of a screen reader,
    // a text search and a printed statement.
    expect(container.querySelectorAll("dt")).toHaveLength(2);
    expect(screen.getByText("5,000.00")).toBeInTheDocument();
    expect(container.querySelector(".ps-aging__track")).toHaveAttribute("aria-hidden", "true");
  });

  it("clamps a share outside 0..1 instead of drawing past the track", () => {
    const { container } = render(
      <AgingBars label="l" buckets={[{ label: "0-30", amount: "1", share: 4 }]} />
    );
    expect(container.querySelector(".ps-aging__bar")).toHaveStyle({ inlineSize: "100%" });
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <AgingBars
        label="l"
        buckets={[
          { label: "0-30", amount: "1", share: 0.4 },
          { label: "31-60", amount: "2", share: 0.3 }
        ]}
      />
    ));
  });
});
