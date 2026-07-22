import { describe, expect, it, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastProvider, useToast } from "./ToastContext";
import { ToastViewport } from "./ToastViewport";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

function Harness() {
  const { push } = useToast();
  return (
    <button onClick={() => push({ title: "Saved", description: "Settings updated", variant: "success", duration: 0 })}>
      Trigger
    </button>
  );
}

describe("Toast", () => {
  it("pushes a toast that renders in the viewport", () => {
    render(
      <ToastProvider>
        <Harness />
        <ToastViewport />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Settings updated")).toBeInTheDocument();
  });

  it("dismisses a toast when its dismiss button is pressed", () => {
    render(
      <ToastProvider>
        <Harness />
        <ToastViewport dismissLabel="Dismiss" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("throws when useToast is used outside a ToastProvider", () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ToastProvider/);
  });

  it("renders identical viewport DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    function build(locale: "ar" | "en") {
      function Inner() {
        const { push } = useToast();
        return (
          <button
            onClick={() =>
              push({
                title: locale === "ar" ? "تم الحفظ" : "Saved",
                variant: "error",
                duration: 0
              })
            }
          >
            go
          </button>
        );
      }
      return (
        <ToastProvider>
          <Inner />
          <ToastViewport />
        </ToastProvider>
      );
    }

    const rtlSignature = withDocumentDirection("rtl", "ar", () => {
      render(build("ar"));
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      const viewport = document.querySelector(".ps-toast-viewport") as Element;
      const sig = structuralSignature(viewport);
      cleanup();
      return sig;
    });
    const ltrSignature = withDocumentDirection("ltr", "en", () => {
      render(build("en"));
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      const viewport = document.querySelector(".ps-toast-viewport") as Element;
      const sig = structuralSignature(viewport);
      cleanup();
      return sig;
    });
    expect(ltrSignature).toEqual(rtlSignature);
  });
});
