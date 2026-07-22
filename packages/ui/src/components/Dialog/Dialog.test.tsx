import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Dialog } from "./Dialog";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Confirm">
        Body
      </Dialog>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders as an accessible modal dialog when open and moves focus into it", () => {
    render(
      <Dialog open onClose={() => {}} title="Confirm">
        <button>Yes</button>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog", { name: "Confirm" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The dialog's own close button precedes body content in DOM order, so
    // it is the first focusable element and receives initial focus.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("calls onClose on Escape and on backdrop click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog open onClose={onClose} title="Confirm">
        Body
      </Dialog>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const overlay = container.querySelector(".ps-dialog-overlay") as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("calls onClose when the close button is pressed", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Confirm" closeLabel="Close">
        Body
      </Dialog>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = (locale: "ar" | "en") => (
      <Dialog open onClose={() => {}} title={locale === "ar" ? "تأكيد" : "Confirm"} closeLabel={locale === "ar" ? "إغلاق" : "Close"}>
        <p>{locale === "ar" ? "هل أنت متأكد؟" : "Are you sure?"}</p>
      </Dialog>
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
