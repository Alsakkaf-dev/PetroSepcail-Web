import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Ltr } from "./Ltr";
import { Money } from "./Money";
import { DateTime } from "./DateTime";
import { IdDisplay } from "./IdDisplay";
import { CopyButton } from "./CopyButton";
import { StatusBadge } from "./StatusBadge";
import { FamilyAccent } from "./FamilyAccent";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

const UUID = "5f3a9c1e-2b7d-4e88-9a11-0c6b7d2e4f10";

describe("Ltr", () => {
  it("isolates in HTML, not only in CSS", () => {
    const { container } = render(<Ltr>SA03 8000 0000 6080 1016 7519</Ltr>);
    const el = container.firstElementChild;
    expect(el?.tagName.toLowerCase()).toBe("bdi");
    expect(el).toHaveClass("ps-ltr");
  });

  it("renders technical strings as code when asked", () => {
    const { container } = render(<Ltr as="code">5W-30</Ltr>);
    expect(container.firstElementChild?.tagName.toLowerCase()).toBe("code");
  });
});

describe("Money", () => {
  it("writes each locale's own form", () => {
    const { container: ar } = render(<Money amount="57.5" locale="ar" />);
    expect(ar.textContent).toBe("57.50 ر.س");
    cleanup();
    const { container: en } = render(<Money amount="57.5" locale="en" />);
    expect(en.textContent).toBe("SAR 57.50");
  });

  it("isolates without forcing direction, so ر.س lands on the right side", () => {
    const { container } = render(<Money amount="57.5" locale="ar" />);
    const el = container.firstElementChild;
    expect(el?.tagName.toLowerCase()).toBe("bdi");
    expect(el).not.toHaveClass("ps-ltr");
  });

  it("passes a non-numeric placeholder through without inventing a currency", () => {
    // The k>=5 privacy suppression renders "—"; "SAR —" would read as a real
    // amount of nothing.
    const { container } = render(<Money amount="—" locale="en" />);
    expect(container.textContent).toBe("—");
  });

  it("announces a struck-through price as struck", () => {
    const { container } = render(<Money amount="99" locale="en" struck />);
    expect(container.firstElementChild?.tagName.toLowerCase()).toBe("s");
  });
});

describe("DateTime", () => {
  it("keeps the machine-readable instant alongside the Riyadh rendering", () => {
    const { container } = render(<DateTime iso="2026-08-04T10:30:00Z" locale="en" />);
    const el = container.querySelector("time");
    expect(el).toHaveAttribute("datetime", "2026-08-04T10:30:00Z");
    expect(el).toHaveAttribute("data-timezone", "Asia/Riyadh");
    // 10:30 UTC is 13:30 in Riyadh — the platform has one operational
    // timezone and every screen reads it.
    expect(el?.textContent).toContain("13:30");
  });

  it("uses Western digits in Arabic too, matching every other numeral", () => {
    const { container } = render(<DateTime iso="2026-08-04T10:30:00Z" locale="ar" />);
    expect(container.textContent).toContain("2026");
    expect(container.textContent).toContain("13:30");
    expect(container.textContent).not.toMatch(/[٠-٩]/);
  });

  it("is isolated but not forced LTR — the Arabic form is Arabic text", () => {
    const { container } = render(<DateTime iso="2026-08-04T10:30:00Z" locale="ar" />);
    expect(container.querySelector("time")).not.toHaveClass("ps-ltr");
  });
});

describe("IdDisplay", () => {
  it("never renders the raw id as the label", () => {
    const { container } = render(<IdDisplay id={UUID} />);
    expect(container.textContent).not.toBe(UUID);
    expect(container.textContent).toContain("5f3a9c1e");
    expect(container.textContent).toContain("…");
  });

  it("keeps the full value reachable — title for a mouse, clipboard for everyone", () => {
    render(<IdDisplay id={UUID} copy={{ label: "نسخ", copiedLabel: "تم النسخ" }} />);
    expect(screen.getByTitle(UUID)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "نسخ" })).toBeInTheDocument();
  });

  it("demotes the id to a detail once a real name is available", () => {
    const { container } = render(<IdDisplay id={UUID} name="زيت سبيشل 5W-30" />);
    expect(container.querySelector(".ps-id__name")).toHaveTextContent("زيت سبيشل 5W-30");
    expect(container.querySelector(".ps-id__value")).toHaveClass("ps-id__value--secondary");
  });
});

describe("CopyButton", () => {
  it("copies the whole value and confirms in a live region", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton value={UUID} label="نسخ" copiedLabel="تم النسخ" />);
    fireEvent.click(screen.getByRole("button", { name: "نسخ" }));
    expect(writeText).toHaveBeenCalledWith(UUID);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("تم النسخ"));
  });

  it("stays quiet when the clipboard is denied — the value is still on screen", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton value={UUID} label="Copy" copiedLabel="Copied" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

describe("StatusBadge", () => {
  it("renders the D-04 label, never the bare enum value", () => {
    const { container: ar } = render(<StatusBadge kind="order" value="en_route" locale="ar" />);
    expect(ar.textContent).toContain("في الطريق إليك");
    expect(ar.textContent).not.toContain("en_route");
    cleanup();
    const { container: en } = render(<StatusBadge kind="order" value="en_route" locale="en" />);
    expect(en.textContent).toContain("On the way");
  });

  it("takes its tone from the status rather than from the call site", () => {
    const { container } = render(<StatusBadge kind="invoice" value="overdue" locale="en" />);
    expect(container.firstElementChild).toHaveClass("ps-badge--danger");
  });

  it("carries a glyph as well as a colour, so tone is never colour alone", () => {
    const { container } = render(<StatusBadge kind="order" value="delivered" locale="en" />);
    expect(container.querySelector("svg")).toHaveClass("ps-icon");
  });
});

describe("FamilyAccent", () => {
  it("colours by family without making colour the only signal", () => {
    const { container } = render(
      <FamilyAccent family="raval" variant="chip">
        رافال
      </FamilyAccent>
    );
    expect(container.firstElementChild).toHaveClass("ps-family--raval", "ps-family--chip");
    expect(container.textContent).toBe("رافال");
  });
});

describe("structural parity across RTL/ar and LTR/en (TC-PC08-002)", () => {
  it("holds for every data primitive", () => {
    const build = (locale: "ar" | "en") => (
      <span>
        <Money amount="57.5" locale={locale} />
        <DateTime iso="2026-08-04T10:30:00Z" locale={locale} />
        <IdDisplay id={UUID} label="x" copy={{ label: "c", copiedLabel: "d" }} />
        <StatusBadge kind="order" value="preparing" locale={locale} />
        <FamilyAccent family="petro">x</FamilyAccent>
        <Ltr>+966 55 697 6912</Ltr>
      </span>
    );
    const rtl = withDocumentDirection("rtl", "ar", () => {
      const { container } = render(build("ar"));
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    const ltr = withDocumentDirection("ltr", "en", () => {
      const { container } = render(build("en"));
      const sig = structuralSignature(container.firstElementChild as Element);
      cleanup();
      return sig;
    });
    expect(ltr).toEqual(rtl);
  });
});
