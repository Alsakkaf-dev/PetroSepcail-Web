import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Select } from "./Select";
import { Textarea } from "./Textarea";
import { Checkbox } from "./Checkbox";
import { RadioGroup } from "./RadioGroup";
import { Switch } from "./Switch";
import { QtyStepper } from "./QtyStepper";
import { FileUpload } from "./FileUpload";
import { Keypad } from "./Keypad";
import { RangeSlider } from "./RangeSlider";
import { Combobox } from "./Combobox";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

const OPTIONS = [
  { value: "cod", label: "الدفع عند الاستلام" },
  { value: "bank_transfer", label: "تحويل بنكي" }
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

describe("Select", () => {
  it("labels the control and wires hint and error to it together", () => {
    render(<Select label="طريقة الدفع" options={OPTIONS} hint="COD أو تحويل" error="اختر طريقة" />);
    const select = screen.getByLabelText(/طريقة الدفع/);
    expect(select).toHaveAttribute("aria-invalid", "true");
    const describedBy = select.getAttribute("aria-describedby") ?? "";
    // The format hint stays readable next to the error, rather than being
    // replaced by it at exactly the moment it is most useful.
    expect(describedBy.split(" ")).toHaveLength(2);
    expect(screen.getByText("COD أو تحويل")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("اختر طريقة");
  });

  it("renders a real disabled placeholder rather than a submittable empty option", () => {
    render(<Select label="x" options={OPTIONS} placeholder="اختر…" />);
    const placeholder = screen.getByRole("option", { name: "اختر…" });
    expect(placeholder).toBeDisabled();
    expect(placeholder).toHaveValue("");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <Select label="l" options={OPTIONS} hint="h" error="e" placeholder="p" />);
  });
});

describe("Textarea", () => {
  it("announces its character counter politely", () => {
    render(<Textarea label="مراجعتك" counter="24 / 1000" />);
    const counter = screen.getByText("24 / 1000");
    expect(counter).toHaveAttribute("aria-live", "polite");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <Textarea label="l" hint="h" counter="1 / 10" />);
  });
});

describe("Checkbox", () => {
  it("keeps a real input in the accessibility tree behind the drawn box", () => {
    render(<Checkbox label="لم يتم فتح العبوة" description="إقرار مطلوب للإرجاع" />);
    const input = screen.getByRole("checkbox", { name: /لم يتم فتح العبوة/ });
    expect(input).toHaveAttribute("type", "checkbox");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("is never checked unless asked — consent is opt-in", () => {
    render(<Checkbox label="تسويق" />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <Checkbox label="l" description="d" error="e" />);
  });
});

describe("RadioGroup", () => {
  it("is a named group, not a pile of loose inputs", () => {
    render(<RadioGroup label="طريقة الدفع" name="pay" options={OPTIONS} value="cod" />);
    const group = screen.getByRole("group", { name: /طريقة الدفع/ });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /الدفع عند الاستلام/ })).toBeChecked();
  });

  it("keeps a dormant option visible and disabled rather than hiding it", () => {
    render(
      <RadioGroup
        label="الدفع"
        name="pay"
        options={[...OPTIONS, { value: "card", label: "الدفع الإلكتروني", disabled: true, trailing: "قريباً" }]}
      />
    );
    const dormant = screen.getByRole("radio", { name: /الدفع الإلكتروني/ });
    expect(dormant).toBeDisabled();
    expect(screen.getByText("قريباً")).toBeVisible();
  });

  it("reports the chosen value", () => {
    const onChange = vi.fn();
    render(<RadioGroup label="l" name="pay" options={OPTIONS} value="cod" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /تحويل بنكي/ }));
    expect(onChange).toHaveBeenCalledWith("bank_transfer");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <RadioGroup
        label="l"
        name="n"
        value="cod"
        options={[{ value: "cod", label: "a", description: "d", trailing: "t" }, { value: "x", label: "b", disabled: true }]}
      />
    ));
  });
});

describe("Switch", () => {
  it("reports on/off rather than checked/unchecked", () => {
    render(<Switch label="تنبيهات" checked onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: /تنبيهات/ })).toHaveAttribute("aria-checked", "true");
  });

  it("states a locked toggle instead of hiding it", () => {
    render(<Switch label="إشعارات داخل التطبيق" checked onChange={() => {}} lockedReason="مفعّلة دائماً" />);
    const control = screen.getByRole("switch");
    expect(control).toBeDisabled();
    expect(screen.getByText("مفعّلة دائماً")).toBeInTheDocument();
  });

  it("toggles to the opposite value", () => {
    const onChange = vi.fn();
    render(<Switch label="l" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <Switch label="l" checked onChange={() => {}} description="d" />);
  });
});

describe("QtyStepper", () => {
  it("stops at its bounds instead of running past them", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <QtyStepper label="الكمية" value={1} onChange={onChange} increaseLabel="زيادة" decreaseLabel="إنقاص" />
    );
    expect(screen.getByRole("button", { name: "إنقاص" })).toBeDisabled();
    rerender(
      <QtyStepper label="الكمية" value={99} onChange={onChange} increaseLabel="زيادة" decreaseLabel="إنقاص" />
    );
    expect(screen.getByRole("button", { name: "زيادة" })).toBeDisabled();
  });

  it("clamps a typed or pasted value rather than ignoring it", () => {
    const onChange = vi.fn();
    render(<QtyStepper label="الكمية" value={2} onChange={onChange} increaseLabel="+" decreaseLabel="-" />);
    fireEvent.change(screen.getByLabelText("الكمية"), { target: { value: "500" } });
    expect(onChange).toHaveBeenCalledWith(99);
  });

  it("uses type=button so bumping a quantity never submits the checkout form", () => {
    render(<QtyStepper label="l" value={2} onChange={() => {}} increaseLabel="+" decreaseLabel="-" />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("type", "button");
    }
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <QtyStepper label="l" value={5} onChange={() => {}} increaseLabel="+" decreaseLabel="-" />);
  });
});

describe("FileUpload", () => {
  it("keeps a real file input behind the drop zone", () => {
    render(<FileUpload label="إثبات التحويل" onFiles={() => {}} browseLabel="اختر ملفاً" />);
    const input = screen.getByLabelText(/إثبات التحويل/);
    expect(input).toHaveAttribute("type", "file");
    // Drag-and-drop is an addition; the visible browse control is the route
    // a keyboard user and a driver on a phone both take.
    expect(screen.getByText("اختر ملفاً")).toBeInTheDocument();
  });

  it("lists what was picked, with a way to take it back", () => {
    const onRemove = vi.fn();
    const file = new File(["x"], "receipt.pdf", { type: "application/pdf" });
    render(
      <FileUpload
        label="l"
        onFiles={() => {}}
        files={[file]}
        onRemove={onRemove}
        browseLabel="b"
        removeLabel="إزالة"
      />
    );
    expect(screen.getByText("receipt.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إزالة receipt.pdf" }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    const file = new File(["x"], "a.pdf");
    parity(() => (
      <FileUpload label="l" onFiles={() => {}} files={[file]} onRemove={() => {}} browseLabel="b" hint="h" />
    ));
  });
});

describe("Keypad", () => {
  it("appends digits up to its length and no further", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Keypad label="رمز التسليم" value="123" onChange={onChange} deleteLabel="حذف" />
    );
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    expect(onChange).toHaveBeenCalledWith("1234");
    onChange.mockClear();
    rerender(<Keypad label="رمز التسليم" value="1234" onChange={onChange} deleteLabel="حذف" />);
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("deletes the last digit", () => {
    const onChange = vi.fn();
    render(<Keypad label="l" value="12" onChange={onChange} deleteLabel="حذف" />);
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));
    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("carries the value on a labelled input, not on four unlabelled boxes", () => {
    const { container } = render(<Keypad label="رمز التسليم" value="12" onChange={() => {}} deleteLabel="d" />);
    expect(screen.getByLabelText("رمز التسليم")).toHaveValue("12");
    expect(container.querySelector(".ps-keypad__cells")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => <Keypad label="l" value="12" onChange={() => {}} deleteLabel="d" status="s" error="e" />);
  });
});

describe("RangeSlider", () => {
  it("cannot be moved past the cap the server quoted", () => {
    render(<RangeSlider label="استخدام النقاط" value={120} max={400} onChange={() => {}} />);
    const input = screen.getByLabelText("استخدام النقاط");
    expect(input).toHaveAttribute("max", "400");
    expect(input).toHaveAttribute("min", "0");
  });

  it("clamps a value that arrived above the cap rather than rendering it", () => {
    render(<RangeSlider label="l" value={900} max={400} onChange={() => {}} />);
    expect(screen.getByLabelText("l")).toHaveValue("400");
  });

  it("announces what the number means, not just the number", () => {
    render(<RangeSlider label="l" value={300} max={400} onChange={() => {}} valueText="300 نقطة" />);
    expect(screen.getByLabelText("l")).toHaveAttribute("aria-valuetext", "300 نقطة");
  });

  it("disables itself when there is nothing to choose between", () => {
    render(<RangeSlider label="l" value={0} max={0} onChange={() => {}} />);
    expect(screen.getByLabelText("l")).toBeDisabled();
  });

  it("reports the chosen value as a number", () => {
    const onChange = vi.fn();
    render(<RangeSlider label="l" value={0} max={400} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("l"), { target: { value: "250" } });
    expect(onChange).toHaveBeenCalledWith(250);
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <RangeSlider label="l" value={100} max={400} onChange={() => {}} hint="h" readout="r" error="e" />
    ));
  });
});

const SUGGESTIONS = [
  { value: "سوبر سبيشل 10W-30", label: "سوبر سبيشل 10W-30", meta: "super-special-10w30" },
  { value: "رافال 5W-30", label: "رافال 5W-30", meta: "raval-5w30" }
];

describe("Combobox", () => {
  it("states the relationship between the field and its list rather than implying it", () => {
    render(<Combobox label="بحث" value="" onChange={() => {}} options={[]} onSelect={() => {}} />);
    const input = screen.getByRole("combobox", { name: "بحث" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input.getAttribute("aria-controls")).toBeTruthy();
  });

  it("opens on typing and closes on Escape", () => {
    render(<Combobox label="بحث" value="سو" onChange={() => {}} options={SUGGESTIONS} onSelect={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("moves the highlight without moving focus off the input", () => {
    render(<Combobox label="بحث" value="س" onChange={() => {}} options={SUGGESTIONS} onSelect={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId!)).toHaveAttribute("aria-selected", "true");
  });

  it("wraps the highlight around both ends", () => {
    render(<Combobox label="بحث" value="س" onChange={() => {}} options={SUGGESTIONS} onSelect={() => {}} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-1$/);
  });

  it("takes the highlighted option on Enter, and never navigates on a bare keystroke", () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn();
    render(
      <Combobox
        label="بحث"
        value="س"
        onChange={() => {}}
        options={SUGGESTIONS}
        onSelect={onSelect}
        onSubmit={onSubmit}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "سوب" } });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[0]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the raw text when nothing is highlighted — searching for a term not in the list", () => {
    const onSubmit = vi.fn();
    render(
      <Combobox label="بحث" value="زيت" onChange={() => {}} options={SUGGESTIONS} onSelect={() => {}} onSubmit={onSubmit} />
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("زيت");
  });

  it("announces how many suggestions there are", () => {
    render(
      <Combobox label="بحث" value="س" onChange={() => {}} options={SUGGESTIONS} onSelect={() => {}} status="اقتراحان" />
    );
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByRole("status")).toHaveTextContent("اقتراحان");
  });

  it("clears the field without clearing the page", () => {
    const onChange = vi.fn();
    render(
      <Combobox label="بحث" value="سوبر" onChange={onChange} options={[]} onSelect={() => {}} clearLabel="مسح" />
    );
    fireEvent.click(screen.getByRole("button", { name: "مسح" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <Combobox
        label="l"
        value="v"
        onChange={() => {}}
        options={SUGGESTIONS}
        onSelect={() => {}}
        hint="h"
        clearLabel="c"
      />
    ));
  });
});
