import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DataTable } from "./DataTable";
import type { DataTableColumn } from "./DataTable";
import { DataList } from "./DataList";
import { Pagination } from "./Pagination";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

interface Invoice {
  id: string;
  number: string;
  total: string;
}

const ROWS: Invoice[] = [
  { id: "1", number: "INV-001", total: "1,200.00" },
  { id: "2", number: "INV-002", total: "980.50" }
];

const COLUMNS: DataTableColumn<Invoice>[] = [
  { key: "number", header: "رقم الفاتورة", render: (r) => r.number, emphasis: "primary", sortable: true },
  { key: "total", header: "الإجمالي", render: (r) => r.total, align: "end", sortable: true }
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

describe("DataTable", () => {
  it("names itself, so assistive tech has more than 'table' to announce", () => {
    render(<DataTable caption="الفواتير" columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />);
    expect(screen.getByRole("table", { name: "الفواتير" })).toBeInTheDocument();
  });

  it("declares its roles explicitly, so the phone layout can't strip them", () => {
    // The stacked-card layout sets display:block on the table, which would
    // otherwise remove table semantics from assistive tech entirely.
    const { container } = render(<DataTable caption="c" columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />);
    expect(container.querySelector("table")).toHaveAttribute("role", "table");
    expect(container.querySelectorAll('[role="row"]')).toHaveLength(3);
    expect(container.querySelectorAll('[role="cell"]')).toHaveLength(4);
  });

  it("labels every cell with its column, for the stacked layout", () => {
    const { container } = render(<DataTable caption="c" columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />);
    expect(container.querySelector('[data-label="الإجمالي"]')).toBeInTheDocument();
  });

  it("reports a sort intent rather than sorting the page it happens to hold", () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        caption="c"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        sort={{ key: "number", direction: "asc" }}
        onSortChange={onSortChange}
      />
    );
    const header = screen.getByRole("columnheader", { name: /رقم الفاتورة/ });
    expect(header).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: /رقم الفاتورة/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "number", direction: "desc" });
  });

  it("starts a newly-sorted column ascending", () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        caption="c"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        sort={{ key: "number", direction: "desc" }}
        onSortChange={onSortChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /الإجمالي/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "total", direction: "asc" });
  });

  it("carries all four universal states itself", () => {
    const { rerender } = render(
      <DataTable caption="c" columns={COLUMNS} rows={[]} getRowKey={(r) => r.id} state="loading" />
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(
      <DataTable
        caption="c"
        columns={COLUMNS}
        rows={[]}
        getRowKey={(r) => r.id}
        state="error"
        errorMessage="تعذّر تحميل الفواتير"
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("تعذّر تحميل الفواتير");

    rerender(<DataTable caption="c" columns={COLUMNS} rows={[]} getRowKey={(r) => r.id} emptyTitle="لا فواتير" />);
    expect(screen.getByText("لا فواتير")).toBeInTheDocument();
  });

  it("treats an empty row set as empty even when the caller says ready", () => {
    render(<DataTable caption="c" columns={COLUMNS} rows={[]} getRowKey={(r) => r.id} emptyTitle="لا شيء" />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <DataTable
        caption="c"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(r) => r.id}
        sort={{ key: "number", direction: "asc" }}
        onSortChange={() => {}}
        sortLabels={{ asc: "a", desc: "d" }}
      />
    ));
  });
});

describe("DataList", () => {
  it("pairs each value with its label as a real description list", () => {
    const { container } = render(
      <DataList
        label="الطلبات"
        items={[{ id: "1", title: "طلب ١", fields: [{ label: "التاريخ", value: "2026-08-04" }] }]}
      />
    );
    expect(screen.getByRole("list", { name: "الطلبات" })).toBeInTheDocument();
    expect(container.querySelector("dt")).toHaveTextContent("التاريخ");
    expect(container.querySelector("dd")).toHaveTextContent("2026-08-04");
  });

  it("carries the same four states as the table", () => {
    render(<DataList label="l" items={[]} emptyTitle="لا طلبات" />);
    expect(screen.getByText("لا طلبات")).toBeInTheDocument();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <DataList
        label="l"
        items={[
          {
            id: "1",
            title: "t",
            status: <span>s</span>,
            fields: [{ label: "a", value: "b" }],
            actions: <button type="button">x</button>,
            href: "/orders/1"
          }
        ]}
      />
    ));
  });
});

describe("Pagination", () => {
  it("disappears when there is only one page", () => {
    const { container } = render(
      <Pagination page={1} pageCount={1} onPageChange={() => {}} label="l" previousLabel="p" nextLabel="n" />
    );
    expect(container.firstElementChild).toBeNull();
  });

  it("marks the current page for assistive tech, not just visually", () => {
    render(<Pagination page={3} pageCount={9} onPageChange={() => {}} label="l" previousLabel="p" nextLabel="n" />);
    expect(screen.getByRole("button", { current: "page" })).toHaveTextContent("3");
  });

  it("disables the arrow that would run off the end", () => {
    const { rerender } = render(
      <Pagination page={1} pageCount={9} onPageChange={() => {}} label="l" previousLabel="السابق" nextLabel="التالي" />
    );
    expect(screen.getByRole("button", { name: "السابق" })).toBeDisabled();
    rerender(
      <Pagination page={9} pageCount={9} onPageChange={() => {}} label="l" previousLabel="السابق" nextLabel="التالي" />
    );
    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
  });

  it("collapses a long run of pages instead of rendering ninety buttons", () => {
    render(<Pagination page={20} pageCount={40} onPageChange={() => {}} label="l" previousLabel="p" nextLabel="n" />);
    // first, last, and a window of five around the current page
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <Pagination
        page={3}
        pageCount={9}
        onPageChange={() => {}}
        label="l"
        previousLabel="p"
        nextLabel="n"
        status="3 / 9"
      />
    ));
  });
});
