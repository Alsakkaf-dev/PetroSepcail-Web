import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Banner } from "./Banner";
import { InlineError } from "./InlineError";
import { Progress } from "./Progress";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("Banner", () => {
  it("interrupts for danger and warn, and only for those", () => {
    render(<Banner tone="danger">تجاوزت حد الائتمان</Banner>);
    expect(screen.getByRole("alert")).toHaveTextContent("تجاوزت حد الائتمان");
    cleanup();
    render(<Banner tone="info">حوّل خلال 48 ساعة</Banner>);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("carries a glyph per tone, so tone is never colour alone", () => {
    const { container } = render(<Banner tone="warn">x</Banner>);
    expect(container.querySelector(".ps-banner__icon svg")).toHaveClass("ps-icon");
  });

  it("lets a caller name a more specific glyph", () => {
    const { container } = render(
      <Banner tone="warn" icon="offline">
        x
      </Banner>
    );
    expect(container.querySelector(".ps-banner__icon svg")).toBeInTheDocument();
  });

  it("keeps the resolving action with the message", () => {
    render(<Banner tone="danger" action={<button type="button">أعد المحاولة</button>}>فشل</Banner>);
    expect(screen.getByRole("button", { name: "أعد المحاولة" })).toBeInTheDocument();
  });
});

describe("InlineError", () => {
  it("is announced and can be wired to its field", () => {
    render(<InlineError id="email-error">بريد إلكتروني غير صالح</InlineError>);
    const el = screen.getByRole("alert");
    expect(el).toHaveAttribute("id", "email-error");
    expect(el).toHaveTextContent("بريد إلكتروني غير صالح");
  });
});

describe("Progress", () => {
  it("exposes the real value to assistive tech", () => {
    render(<Progress value={30} max={200} label="التقدم نحو التوصيل المجاني" hint="باقٍ 170 ر.س" />);
    const bar = screen.getByRole("progressbar", { name: "التقدم نحو التوصيل المجاني" });
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("aria-valuemax", "200");
    expect(bar).toHaveAttribute("aria-valuetext", "باقٍ 170 ر.س");
  });

  it("clamps out-of-range values rather than overflowing its track", () => {
    render(<Progress value={500} max={200} label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "200");
    cleanup();
    render(<Progress value={-5} max={200} label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("survives a zero max instead of dividing by it", () => {
    render(<Progress value={1} max={0} label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "1");
  });

  it("sets the dynamic width inside packages/ui, which is what keeps apps free of inline styles", () => {
    const { container } = render(<Progress value={50} max={200} label="x" />);
    expect(container.querySelector(".ps-progress__fill")).toHaveStyle({ inlineSize: "25%" });
  });
});

describe("structural parity across RTL/ar and LTR/en (TC-PC08-002)", () => {
  it("holds for every feedback primitive", () => {
    const build = (locale: "ar" | "en") => (
      <div>
        <Banner tone="warn" title={locale === "ar" ? "تنبيه" : "Heads up"} action={<button type="button">a</button>}>
          {locale === "ar" ? "نص" : "text"}
        </Banner>
        <InlineError id="e">{locale === "ar" ? "خطأ" : "error"}</InlineError>
        <Progress value={10} max={20} label="p" hint="h" />
      </div>
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
