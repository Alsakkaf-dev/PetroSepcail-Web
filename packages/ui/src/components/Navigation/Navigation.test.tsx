import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Tabs } from "./Tabs";
import { Segmented } from "./Segmented";
import { Breadcrumb } from "./Breadcrumb";
import { Chip } from "./Chip";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

const TAB_ITEMS = [
  { id: "proofs", label: "إثباتات التحويل" },
  { id: "remittances", label: "توريدات الأمانة" }
];

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

describe("Tabs", () => {
  it("is one tab stop for the whole set", () => {
    render(
      <Tabs label="طابور التحقق" items={TAB_ITEMS} value="proofs" onChange={() => {}}>
        panel
      </Tabs>
    );
    expect(screen.getByRole("tab", { name: "إثباتات التحويل" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "توريدات الأمانة" })).toHaveAttribute("tabindex", "-1");
  });

  it("ties the panel to its tab in both directions", () => {
    render(
      <Tabs label="l" items={TAB_ITEMS} value="proofs" onChange={() => {}}>
        panel
      </Tabs>
    );
    const tab = screen.getByRole("tab", { selected: true });
    const panel = screen.getByRole("tabpanel");
    expect(tab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  });

  it("follows visual order with the arrow keys, so RTL moves the way it looks", () => {
    const onChange = vi.fn();
    withDocumentDirection("rtl", "ar", () => {
      render(
        <Tabs label="l" items={TAB_ITEMS} value="proofs" onChange={onChange}>
          panel
        </Tabs>
      );
      fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowLeft" });
    });
    expect(onChange).toHaveBeenCalledWith("remittances");
  });

  it("skips a disabled tab rather than stopping on it", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="l"
        items={[TAB_ITEMS[0]!, { id: "x", label: "معطّل", disabled: true }, TAB_ITEMS[1]!]}
        value="proofs"
        onChange={onChange}
      >
        panel
      </Tabs>
    );
    fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("remittances");
  });

  it("jumps to the ends with Home and End", () => {
    const onChange = vi.fn();
    render(
      <Tabs label="l" items={TAB_ITEMS} value="remittances" onChange={onChange}>
        panel
      </Tabs>
    );
    fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "Home" });
    expect(onChange).toHaveBeenCalledWith("proofs");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <Tabs label="l" items={[{ id: "a", label: "a", badge: 3 }, { id: "b", label: "b" }]} value="a" onChange={() => {}}>
        panel
      </Tabs>
    ));
  });
});

describe("Segmented", () => {
  it("is a named group with a current value, not a row of loose buttons", () => {
    render(
      <Segmented
        label="ترتيب المسار"
        options={[
          { value: "route", label: "حسب المسار" },
          { value: "type", label: "حسب النوع" }
        ]}
        value="route"
        onChange={() => {}}
      />
    );
    expect(screen.getByRole("radiogroup", { name: "ترتيب المسار" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "حسب المسار" })).toBeChecked();
  });

  it("reports the chosen value", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="l"
        options={[
          { value: "a", label: "a" },
          { value: "b", label: "b" }
        ]}
        value="a"
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: "b" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <Segmented
        label="l"
        block
        options={[
          { value: "a", label: "a" },
          { value: "b", label: "b", disabled: true }
        ]}
        value="a"
        onChange={() => {}}
      />
    ));
  });
});

describe("Breadcrumb", () => {
  it("marks the page you are on and does not link it", () => {
    render(
      <Breadcrumb
        label="مسار التنقل"
        items={[
          { label: "الكتالوج", href: "/catalog" },
          { label: "سبيشل", href: "/catalog/special" },
          { label: "5W-30" }
        ]}
      />
    );
    expect(screen.getByRole("navigation", { name: "مسار التنقل" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "5W-30" })).not.toBeInTheDocument();
    expect(screen.getByText("5W-30")).toHaveAttribute("aria-current", "page");
  });

  it("hides the separators — a screen reader hears the trail, not four chevrons", () => {
    const { container } = render(
      <Breadcrumb label="l" items={[{ label: "a", href: "/a" }, { label: "b" }]} />
    );
    expect(container.querySelector(".ps-breadcrumb__separator")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <Breadcrumb label="l" items={[{ label: "a", href: "/a" }, { label: "b" }]} />);
  });
});

describe("Chip", () => {
  it("is a link when the filter lives in the URL, which is what makes a filtered catalogue shareable", () => {
    render(<Chip label="رافال" href="/catalog?family=raval" tone="raval" />);
    expect(screen.getByRole("link", { name: /رافال/ })).toHaveAttribute("href", "/catalog?family=raval");
  });

  it("marks the selected filter for assistive tech, not only by inverting it", () => {
    render(<Chip label="الكل" href="/catalog" selected />);
    expect(screen.getByRole("link")).toHaveAttribute("aria-current", "true");
  });

  it("carries a facet count beside its label", () => {
    render(<Chip label="سبيشل" href="/c" count="11" />);
    expect(screen.getByRole("link")).toHaveTextContent("11");
  });

  it("gives removal its own labelled target, separate from the filter itself", () => {
    render(<Chip label="5W-30" removeHref="/catalog" removeLabel="إزالة عامل التصفية 5W-30" />);
    expect(screen.getByRole("link", { name: "إزالة عامل التصفية 5W-30" })).toHaveAttribute("href", "/catalog");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const node = () => <Chip label="سبيشل" href="/c" count="11" tone="special" selected />;
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
