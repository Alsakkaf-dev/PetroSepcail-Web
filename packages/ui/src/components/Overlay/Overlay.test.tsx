import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Sheet } from "./Sheet";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("Sheet", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <Sheet open={false} onClose={() => {}} title="الفلاتر">
        body
      </Sheet>
    );
    expect(container.firstElementChild).toBeNull();
  });

  it("is a modal dialog named by its own title", () => {
    render(
      <Sheet open onClose={() => {}} title="الفلاتر">
        body
      </Sheet>
    );
    const sheet = screen.getByRole("dialog", { name: "الفلاتر" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
  });

  it("closes on Escape, on the close button, and on the backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Sheet open onClose={onClose} title="t" closeLabel="إغلاق">
        body
      </Sheet>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "إغلاق" }));
    fireEvent.mouseDown(container.querySelector(".ps-sheet-overlay") as Element);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("moves focus in on open and back to the trigger on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { rerender } = render(
      <Sheet open onClose={() => {}} title="t" closeLabel="إغلاق">
        <button type="button">inside</button>
      </Sheet>
    );
    // The close button is the first focusable thing in the panel.
    expect(screen.getByRole("button", { name: "إغلاق" })).toHaveFocus();
    rerender(
      <Sheet open={false} onClose={() => {}} title="t" closeLabel="إغلاق">
        <button type="button">inside</button>
      </Sheet>
    );
    // Without this a keyboard user who closes a filter sheet is dropped back
    // at the top of the document.
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("keeps Tab inside the panel", () => {
    render(
      <Sheet open onClose={() => {}} title="t" closeLabel="إغلاق" footer={<button type="button">apply</button>}>
        <button type="button">first</button>
      </Sheet>
    );
    // From the last focusable, Tab wraps to the first rather than escaping
    // into the page behind the sheet.
    screen.getByRole("button", { name: "apply" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "إغلاق" })).toHaveFocus();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = () => (
      <Sheet open onClose={() => {}} title="t" placement="inline-end" footer={<button type="button">a</button>}>
        <p>body</p>
      </Sheet>
    );
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
  });
});
