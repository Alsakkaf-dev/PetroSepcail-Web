import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Card, CardFooter, CardHeader } from "./Card";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

describe("Card", () => {
  it("renders padded by default", () => {
    render(<Card>Body</Card>);
    expect(screen.getByText("Body")).toHaveClass("ps-card", "ps-card--padded");
  });

  it("composes header/footer slots", () => {
    render(
      <Card>
        <CardHeader>Title</CardHeader>
        <span>Body</span>
        <CardFooter>Actions</CardFooter>
      </Card>
    );
    expect(screen.getByText("Title")).toHaveClass("ps-card__header");
    expect(screen.getByText("Actions")).toHaveClass("ps-card__footer");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const build = (locale: "ar" | "en") => (
      <Card>
        <CardHeader>{locale === "ar" ? "عنوان" : "Title"}</CardHeader>
        <CardFooter>{locale === "ar" ? "إجراءات" : "Actions"}</CardFooter>
      </Card>
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
