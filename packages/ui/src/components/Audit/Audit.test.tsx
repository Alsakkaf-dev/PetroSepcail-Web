import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JsonView } from "./JsonView";
import { DiffView } from "./DiffView";
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

describe("JsonView", () => {
  it("renders the payload as selectable, searchable text", () => {
    const { container } = render(<JsonView label="قبل" value={{ status: "paid", total: "120.00" }} />);
    const body = container.querySelector("pre");
    expect(body?.textContent).toContain('"status": "paid"');
    // A collapsible tree would hide exactly the rows an investigation is
    // looking for, and would not survive a printout.
    expect(body?.querySelector("code")).toHaveClass("ps-ltr");
  });

  it("masks the keys it is told to, at any depth", () => {
    render(
      <JsonView
        label="بعد"
        value={{ customer: { phone: "+966555000000", city: "جدة" } }}
        redactKeys={["phone"]}
        redactedLabel="محجوب"
      />
    );
    expect(screen.getByText(/محجوب/)).toBeInTheDocument();
    expect(screen.queryByText(/\+966555000000/)).not.toBeInTheDocument();
  });

  it("leaves arrays intact while redacting inside them", () => {
    const { container } = render(
      <JsonView label="l" value={{ lines: [{ sku: "A", phone: "x" }] }} redactKeys={["phone"]} redactedLabel="•" />
    );
    expect(container.textContent).toContain('"sku": "A"');
    expect(container.textContent).not.toContain('"phone": "x"');
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <JsonView label="l" value={{ a: 1 }} />);
  });
});

describe("DiffView", () => {
  it("names each field and shows both values", () => {
    render(
      <DiffView
        label="معاينة التغيير"
        beforeLabel="قبل"
        afterLabel="بعد"
        rows={[{ field: "العنوان", before: "جدة", after: "مكة" }]}
      />
    );
    expect(screen.getByRole("table", { name: "معاينة التغيير" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "العنوان" })).toBeInTheDocument();
    expect(screen.getByText("جدة")).toBeInTheDocument();
    expect(screen.getByText("مكة")).toBeInTheDocument();
  });

  it("marks direction with a glyph as well as a tint", () => {
    const { container } = render(
      <DiffView label="l" beforeLabel="b" afterLabel="a" rows={[{ field: "f", before: "1", after: "2" }]} />
    );
    expect(container.querySelector(".ps-diff__before svg")).toBeInTheDocument();
    expect(container.querySelector(".ps-diff__after svg")).toBeInTheDocument();
  });

  it("says so when nothing would change", () => {
    render(<DiffView label="l" beforeLabel="b" afterLabel="a" rows={[]} emptyLabel="لا تغييرات" />);
    expect(screen.getByText("لا تغييرات")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <DiffView label="l" beforeLabel="b" afterLabel="a" rows={[{ field: "f", before: "1", after: "2" }]} />
    ));
  });
});
