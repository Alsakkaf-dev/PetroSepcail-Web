import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Rating } from "./Rating";
import { RatingInput } from "./RatingInput";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

const STAR_LABELS = ["نجمة واحدة", "نجمتان", "٣ نجوم", "٤ نجوم", "٥ نجوم"] as const;

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

describe("Rating", () => {
  it("puts the figure in text and leaves the stars to the eye", () => {
    render(<Rating value={4.2} label="4.2 من 5" count="38 تقييماً" />);
    expect(screen.getByText("4.2 من 5")).toBeInTheDocument();
    expect(screen.getByText("38 تقييماً")).toBeInTheDocument();
  });

  it("lights whole stars only, rounded from the exact value", () => {
    const { container } = render(<Rating value={4.2} label="4.2 من 5" />);
    expect(container.querySelectorAll(".ps-rating__star--on")).toHaveLength(4);
    cleanup();
    const { container: high } = render(<Rating value={4.6} label="4.6 من 5" />);
    expect(high.querySelectorAll(".ps-rating__star--on")).toHaveLength(5);
  });

  it("clamps a value outside 0..5 rather than drawing six stars", () => {
    const { container } = render(<Rating value={9} label="—" />);
    expect(container.querySelectorAll(".ps-rating__star--on")).toHaveLength(5);
    cleanup();
    const { container: low } = render(<Rating value={-3} label="—" />);
    expect(low.querySelectorAll(".ps-rating__star--on")).toHaveLength(0);
  });
});

describe("RatingInput", () => {
  it("is five named radios in a named group, not a row of pictures", () => {
    render(<RatingInput label="تقييمك" name="stars" starLabels={STAR_LABELS} />);
    expect(screen.getByRole("group", { name: "تقييمك" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "٤ نجوم" })).toBeInTheDocument();
  });

  it("reports the star that was picked", () => {
    const onChange = vi.fn();
    render(<RatingInput label="تقييمك" name="stars" starLabels={STAR_LABELS} value={2} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "٥ نجوم" }));
    expect(onChange).toHaveBeenCalledWith(5);
    expect(screen.getByRole("radio", { name: "نجمتان" })).toBeChecked();
  });

  it("links its error to the group and announces it", () => {
    render(
      <RatingInput
        label="تقييمك"
        name="stars"
        starLabels={STAR_LABELS}
        error="اختر عدد النجوم"
        hint="من ١ إلى ٥"
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("اختر عدد النجوم");
    // The hint survives the error rather than being replaced by it.
    expect(screen.getByText("من ١ إلى ٥")).toBeInTheDocument();
  });

  it("keeps the same structure in both directions", () => {
    parity(() => <Rating value={3} label="3 من 5" count="12" />);
    parity(() => <RatingInput label="تقييمك" name="stars" starLabels={STAR_LABELS} value={3} onChange={() => {}} />);
  });
});
