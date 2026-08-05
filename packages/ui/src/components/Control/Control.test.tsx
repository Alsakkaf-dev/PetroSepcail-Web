import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReasonGate, isReasonReady } from "./ReasonGate";
import { DualControl } from "./DualControl";
import { RuleBuilder, isRuleValid, toRuleValue } from "./RuleBuilder";
import { structuralSignature, withDocumentDirection } from "../../testing/domSnapshot";

afterEach(cleanup);

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

const REASONS = [
  { value: "customer_request", label: "بطلب من العميل" },
  { value: "other_with_note", label: "سبب آخر", requiresNote: true }
];

describe("ReasonGate", () => {
  it("keeps the commit control disabled until a reason is chosen", () => {
    render(
      <ReasonGate
        label="رمز السبب"
        name="r"
        options={REASONS}
        value=""
        onChange={() => {}}
        note=""
        onNoteChange={() => {}}
        noteLabel="ملاحظة"
        hint="اختر رمز سبب"
      >
        {(ready) => (
          <button type="button" disabled={!ready}>
            تنفيذ
          </button>
        )}
      </ReasonGate>
    );
    expect(screen.getByRole("button", { name: "تنفيذ" })).toBeDisabled();
    expect(screen.getByText("اختر رمز سبب")).toBeInTheDocument();
  });

  it("enables it once a reason that needs no note is chosen", () => {
    render(
      <ReasonGate
        label="l"
        name="r"
        options={REASONS}
        value="customer_request"
        onChange={() => {}}
        note=""
        onNoteChange={() => {}}
        noteLabel="ملاحظة"
      >
        {(ready) => (
          <button type="button" disabled={!ready}>
            تنفيذ
          </button>
        )}
      </ReasonGate>
    );
    expect(screen.getByRole("button", { name: "تنفيذ" })).toBeEnabled();
  });

  it("asks for the note on other_with_note, and holds the commit until it is written", () => {
    const { rerender } = render(
      <ReasonGate
        label="l"
        name="r"
        options={REASONS}
        value="other_with_note"
        onChange={() => {}}
        note=""
        onNoteChange={() => {}}
        noteLabel="اشرح السبب"
      >
        {(ready) => (
          <button type="button" disabled={!ready}>
            تنفيذ
          </button>
        )}
      </ReasonGate>
    );
    expect(screen.getByLabelText(/اشرح السبب/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تنفيذ" })).toBeDisabled();

    rerender(
      <ReasonGate
        label="l"
        name="r"
        options={REASONS}
        value="other_with_note"
        onChange={() => {}}
        note="العميل اتصل"
        onNoteChange={() => {}}
        noteLabel="اشرح السبب"
      >
        {(ready) => (
          <button type="button" disabled={!ready}>
            تنفيذ
          </button>
        )}
      </ReasonGate>
    );
    expect(screen.getByRole("button", { name: "تنفيذ" })).toBeEnabled();
  });

  it("offers only codes from the fixed list — never a free-text reason", () => {
    render(
      <ReasonGate
        label="l"
        name="r"
        options={REASONS}
        value="customer_request"
        onChange={() => {}}
        note=""
        onNoteChange={() => {}}
        noteLabel="n"
      >
        {() => null}
      </ReasonGate>
    );
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("exposes the same readiness rule the gate uses", () => {
    expect(isReasonReady(REASONS, "", "")).toBe(false);
    expect(isReasonReady(REASONS, "customer_request", "")).toBe(true);
    expect(isReasonReady(REASONS, "other_with_note", "   ")).toBe(false);
    expect(isReasonReady(REASONS, "other_with_note", "x")).toBe(true);
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <ReasonGate
        label="l"
        name="r"
        options={REASONS}
        value="other_with_note"
        onChange={() => {}}
        note=""
        onNoteChange={() => {}}
        noteLabel="n"
        hint="h"
      >
        {(ready) => (
          <button type="button" disabled={!ready}>
            c
          </button>
        )}
      </ReasonGate>
    ));
  });
});

const DUAL_LABELS = {
  thresholdNote: "تغيير يتجاوز 100,000 ر.س يتطلب موافقة مشرف عام آخر",
  pendingLabel: "بانتظار موافقة مشرف عام آخر",
  approvedLabel: "تمت الموافقة",
  rejectedLabel: "رُفض"
};

describe("DualControl", () => {
  it("states the threshold even below it — the rule is learned before it bites", () => {
    render(<DualControl state="below-threshold" {...DUAL_LABELS} />);
    expect(screen.getByText(DUAL_LABELS.thresholdNote)).toBeInTheDocument();
    expect(screen.queryByText(DUAL_LABELS.pendingLabel)).toBeNull();
  });

  it("names the state rather than leaving a bare status string in a cell", () => {
    render(<DualControl state="pending" {...DUAL_LABELS} />);
    expect(screen.getByText(DUAL_LABELS.pendingLabel)).toBeInTheDocument();
  });

  it("announces a change of state without stealing focus", () => {
    const { container } = render(<DualControl state="approved" {...DUAL_LABELS} />);
    expect(container.querySelector(".ps-dual")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(DUAL_LABELS.approvedLabel)).toBeInTheDocument();
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <DualControl
        state="pending"
        {...DUAL_LABELS}
        summary={<p>s</p>}
        actions={<button type="button">a</button>}
      />
    ));
  });
});

const FIELDS = [
  { value: "order_total", label: "قيمة الطلب", operators: ["gte", "lte"], type: "number" as const },
  {
    value: "family",
    label: "العائلة",
    operators: ["eq"],
    type: "enum" as const,
    choices: [{ value: "raval", label: "رافال" }]
  }
];

const RULE_LABELS = {
  field: "الحقل",
  operator: "الشرط",
  value: "القيمة",
  add: "إضافة شرط",
  remove: "حذف",
  and: "كل الشروط",
  or: "أي شرط",
  empty: "قاعدة بلا شروط تنطبق على الجميع",
  valueRequired: "أدخل قيمة"
};

const OPERATORS = { gte: "أكبر من أو يساوي", lte: "أصغر من أو يساوي", eq: "يساوي" };

describe("RuleBuilder", () => {
  it("says so when the rule is empty, because an empty rule matches everyone", () => {
    render(
      <RuleBuilder
        label="شروط الاستحقاق"
        fields={FIELDS}
        conditions={[]}
        combinator="and"
        onCombinatorChange={() => {}}
        onConditionChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        labels={RULE_LABELS}
        operatorLabels={OPERATORS}
      />
    );
    expect(screen.getByText(RULE_LABELS.empty)).toBeInTheDocument();
  });

  it("offers only fields it was given — a rule can never name something that does not exist", () => {
    render(
      <RuleBuilder
        label="l"
        fields={FIELDS}
        conditions={[{ id: "1", field: "order_total", operator: "gte", value: "500" }]}
        combinator="and"
        onCombinatorChange={() => {}}
        onConditionChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        labels={RULE_LABELS}
        operatorLabels={OPERATORS}
      />
    );
    const fieldSelect = screen.getByLabelText(RULE_LABELS.field);
    expect(fieldSelect.querySelectorAll("option")).toHaveLength(2);
  });

  it("resets the operator when the field changes, so it cannot strand an unsupported one", () => {
    const onConditionChange = vi.fn();
    render(
      <RuleBuilder
        label="l"
        fields={FIELDS}
        conditions={[{ id: "1", field: "order_total", operator: "gte", value: "500" }]}
        combinator="and"
        onCombinatorChange={() => {}}
        onConditionChange={onConditionChange}
        onAdd={() => {}}
        onRemove={() => {}}
        labels={RULE_LABELS}
        operatorLabels={OPERATORS}
      />
    );
    fireEvent.change(screen.getByLabelText(RULE_LABELS.field), { target: { value: "family" } });
    expect(onConditionChange).toHaveBeenCalledWith("1", { field: "family", operator: "eq", value: "" });
  });

  it("marks the incomplete line rather than refusing to save with one message at the bottom", () => {
    render(
      <RuleBuilder
        label="l"
        fields={FIELDS}
        conditions={[{ id: "1", field: "order_total", operator: "gte", value: "" }]}
        combinator="and"
        onCombinatorChange={() => {}}
        onConditionChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        labels={RULE_LABELS}
        operatorLabels={OPERATORS}
      />
    );
    expect(screen.getByLabelText(new RegExp(RULE_LABELS.value))).toHaveAttribute("aria-invalid", "true");
  });

  it("validates and serialises the same way the screen does", () => {
    const conditions = [{ id: "1", field: "order_total", operator: "gte", value: "500" }];
    expect(isRuleValid([])).toBe(false);
    expect(isRuleValid([{ id: "1", field: "f", operator: "eq", value: " " }])).toBe(false);
    expect(isRuleValid(conditions)).toBe(true);
    expect(toRuleValue("or", conditions)).toEqual({
      combinator: "or",
      conditions: [{ field: "order_total", operator: "gte", value: "500" }]
    });
  });

  it("renders identical DOM structure across RTL/ar and LTR/en (TC-PC08-002)", () => {
    parity(() => (
      <RuleBuilder
        label="l"
        fields={FIELDS}
        conditions={[{ id: "1", field: "order_total", operator: "gte", value: "500" }]}
        combinator="and"
        onCombinatorChange={() => {}}
        onConditionChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        labels={RULE_LABELS}
        operatorLabels={OPERATORS}
        preview={<span>p</span>}
      />
    ));
  });
});
