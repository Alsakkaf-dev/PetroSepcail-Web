import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ErrorState } from "./ErrorState";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("ErrorState", () => {
  it("renders the message as an alert region", () => {
    render(<ErrorState message="SERVER_ERROR" />);
    expect(screen.getByRole("alert")).toHaveTextContent("SERVER_ERROR");
  });

  it("calls onRetry when the retry button is pressed", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="SERVER_ERROR" onRetry={onRetry} retryLabel="Try again" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("omits the retry button when onRetry is not given", () => {
    render(<ErrorState message="SERVER_ERROR" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = (locale: "ar" | "en") => (
      <ErrorState message={locale === "ar" ? "خطأ في الخادم" : "Server error"} onRetry={() => {}} retryLabel={locale === "ar" ? "إعادة المحاولة" : "Retry"} />
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
