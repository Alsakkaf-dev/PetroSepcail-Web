import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StatCard, KpiTile } from "./StatCard";
import { Timeline, Stepper } from "./Timeline";
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

describe("StatCard", () => {
  it("reads label before value, whatever the visual order", () => {
    const { container } = render(<StatCard label="الطلبات المفتوحة" value="12" />);
    const children = Array.from(container.firstElementChild?.children ?? []);
    expect(children[0]).toHaveTextContent("الطلبات المفتوحة");
    expect(children[1]).toHaveTextContent("12");
  });

  it("becomes a link without changing what it is", () => {
    render(<StatCard label="l" value="1" href="/orders" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/orders");
  });

  it("takes the app's own link component, so packages/ui never imports next", () => {
    function FakeLink({ href, children, ...rest }: { href: string; children: React.ReactNode }) {
      return (
        <a href={href} data-router="true" {...rest}>
          {children}
        </a>
      );
    }
    render(<StatCard label="l" value="1" href="/orders" linkAs={FakeLink} />);
    expect(screen.getByRole("link")).toHaveAttribute("data-router", "true");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <StatCard label="l" value="1" caption="c" icon="cart" tone="gold" />);
  });
});

describe("KpiTile", () => {
  it("renders an em dash and an explanation under the privacy floor, never the value", () => {
    render(<KpiTile label="العملاء" value="3" suppressedLabel="أقل من حد الخصوصية" />);
    expect(screen.queryByText("3")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("أقل من حد الخصوصية")).toBeInTheDocument();
  });

  it("keeps the as-of time and the formula available, not just on hover", () => {
    const { container } = render(
      <KpiTile label="المبيعات" value="1,200" asOf="حتى 13:30" formula="sum(order.total) where status=delivered" />
    );
    expect(container.firstElementChild).toHaveAttribute("title", "sum(order.total) where status=delivered");
    expect(screen.getByText("حتى 13:30")).toBeInTheDocument();
    // Also in the accessibility tree, since a title attribute alone is not
    // reachable by keyboard or touch.
    expect(screen.getByText("sum(order.total) where status=delivered")).toHaveClass("ps-visually-hidden");
  });

  it("labels a trend rather than leaving an arrow to mean up-is-good", () => {
    render(<KpiTile label="l" value="1" trend={{ direction: "down", label: "‎-4% عن الشهر الماضي" }} />);
    expect(screen.getByText("‎-4% عن الشهر الماضي")).toBeInTheDocument();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <KpiTile label="l" value="1" asOf="a" formula="f" trend={{ direction: "up", label: "t" }} icon="truck" />
    ));
  });
});

describe("Timeline", () => {
  it("is an ordered list, because the sequence is the content", () => {
    render(
      <Timeline
        label="مسار الطلب"
        entries={[
          { id: "1", title: "مؤكد", tone: "done" },
          { id: "2", title: "في الطريق إليك", tone: "current" }
        ]}
      />
    );
    const list = screen.getByRole("list", { name: "مسار الطلب" });
    expect(list.tagName.toLowerCase()).toBe("ol");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("hides the markers — meaning lives in the title and the timestamp", () => {
    const { container } = render(<Timeline label="l" entries={[{ id: "1", title: "t" }]} />);
    expect(container.querySelector(".ps-timeline__marker")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <Timeline
        label="l"
        entries={[
          { id: "1", title: "a", timestamp: "t", detail: "d", tone: "done" },
          { id: "2", title: "b", tone: "failed" }
        ]}
      />
    ));
  });
});

describe("Stepper", () => {
  it("marks the current step for assistive tech", () => {
    render(
      <Stepper
        label="خطوات الدفع"
        current={1}
        steps={[
          { id: "address", label: "العنوان" },
          { id: "slot", label: "الموعد" },
          { id: "pay", label: "الدفع" }
        ]}
      />
    );
    const steps = screen.getAllByRole("listitem");
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(steps[0]).not.toHaveAttribute("aria-current");
  });

  it("gives position as words, not as a picture of circles", () => {
    render(
      <Stepper label="l" current={0} status="الخطوة 1 من 4" steps={[{ id: "a", label: "a" }]} />
    );
    const status = screen.getByText("الخطوة 1 من 4");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("shows the hint only on the step being worked on", () => {
    render(
      <Stepper
        label="l"
        current={0}
        steps={[
          { id: "a", label: "a", hint: "اختر عنواناً" },
          { id: "b", label: "b", hint: "لاحقاً" }
        ]}
      />
    );
    expect(screen.getByText("اختر عنواناً")).toBeInTheDocument();
    expect(screen.queryByText("لاحقاً")).not.toBeInTheDocument();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <Stepper
        label="l"
        current={1}
        status="s"
        stateLabels={{ done: "d", current: "c", upcoming: "u" }}
        steps={[
          { id: "a", label: "a" },
          { id: "b", label: "b", hint: "h" },
          { id: "c", label: "c" }
        ]}
      />
    ));
  });
});
