import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Table } from "./Table";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

interface Row {
  id: string;
  name: string;
}

const columns = [
  { key: "name", header: "Name", render: (r: Row) => r.name }
];
const rows: Row[] = [
  { id: "1", name: "Golden Super 20W-50" },
  { id: "2", name: "Raval 5W-30" }
];

describe("Table", () => {
  it("renders rows in ready state", () => {
    render(<Table columns={columns} rows={rows} getRowKey={(r) => r.id} caption="Products" />);
    expect(screen.getByText("Golden Super 20W-50")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 rows
  });

  it("renders EmptyState when rows is empty", () => {
    render(<Table columns={columns} rows={[]} getRowKey={(r) => r.id} emptyTitle="No products" />);
    expect(screen.getByText("No products")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders LoadingState when state='loading'", () => {
    render(<Table columns={columns} rows={rows} getRowKey={(r) => r.id} state="loading" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders ErrorState with retry when state='error'", () => {
    const onRetry = vi.fn();
    render(<Table columns={columns} rows={rows} getRowKey={(r) => r.id} state="error" errorMessage="SERVER_ERROR" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("SERVER_ERROR");
    fireEvent.click(screen.getByRole("button"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = (locale: "ar" | "en") => (
      <Table
        columns={[{ key: "name", header: locale === "ar" ? "الاسم" : "Name", render: (r: Row) => r.name }]}
        rows={rows}
        getRowKey={(r) => r.id}
        caption={locale === "ar" ? "المنتجات" : "Products"}
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
