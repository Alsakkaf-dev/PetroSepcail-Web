"use client";

import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Button } from "../Button/Button";
import { Icon } from "../../icons";
import { InlineError } from "../Feedback/InlineError";
import { Segmented } from "../Navigation/Segmented";
import { Select } from "../Form/Select";
import { TextField } from "../TextField/TextField";

export type RuleCombinator = "and" | "or";

export interface RuleFieldOption {
  value: string;
  label: string;
  /** Which operators make sense for this field. A date field offered
   * "contains" is how a rule builder produces rules nobody can satisfy. */
  operators: string[];
  /** `number` and `date` get the right keyboard and the right validation;
   * `enum` gets a `<select>` built from `choices`. */
  type?: "text" | "number" | "date" | "enum";
  choices?: Array<{ value: string; label: string }>;
}

export interface RuleCondition {
  id: string;
  field: string;
  operator: string;
  value: string;
}

/** The shape the builder emits. `AC-04`'s eligibility-rule endpoint takes an
 * open `Record<string, unknown>`, so this defines it: a combinator plus a flat
 * list of conditions. Flat on purpose — nested groups double the interface and
 * no promotion rule in the spec set needs them. */
export interface RuleValue {
  combinator: RuleCombinator;
  conditions: Array<{ field: string; operator: string; value: string }>;
}

export interface RuleBuilderProps {
  label: string;
  fields: RuleFieldOption[];
  conditions: RuleCondition[];
  combinator: RuleCombinator;
  onCombinatorChange: (next: RuleCombinator) => void;
  onConditionChange: (id: string, patch: Partial<RuleCondition>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  labels: {
    field: string;
    operator: string;
    value: string;
    add: string;
    remove: string;
    and: string;
    or: string;
    /** Shown when the rule has no conditions — an empty rule matches
     * everyone, which is almost never what was meant. */
    empty: string;
    /** Per-condition: shown when the value is blank. */
    valueRequired: string;
  };
  /** Localised operator names, keyed by operator code. */
  operatorLabels: Record<string, string>;
  /** A live preview of what the rule means, in words. */
  preview?: ReactNode;
  className?: string;
}

/** Every condition complete. Exported so the screen can disable its save
 * control on the same answer the builder shows inline. */
export function isRuleValid(conditions: RuleCondition[]): boolean {
  return conditions.length > 0 && conditions.every((condition) => condition.value.trim().length > 0);
}

/** Turn the builder's state into the payload the API stores. */
export function toRuleValue(combinator: RuleCombinator, conditions: RuleCondition[]): RuleValue {
  return {
    combinator,
    conditions: conditions.map(({ field, operator, value }) => ({ field, operator, value }))
  };
}

/**
 * A no-code eligibility rule: field, operator, value, joined by AND or OR.
 *
 * SCR-AC04-001 asks for this so a promotion's audience can be changed without
 * a deploy. Two things it deliberately refuses to do:
 *
 *  - No free-text field names. The field list comes from the caller, so a
 *    rule can only ever reference something that exists.
 *  - No nesting. A flat list with one combinator covers every rule in the
 *    spec set, and nested groups double the interface for a case nobody
 *    asked for.
 *
 * Validation is live and per-condition, so an incomplete rule says which line
 * is incomplete rather than refusing to save with one message at the bottom.
 */
export function RuleBuilder({
  label,
  fields,
  conditions,
  combinator,
  onCombinatorChange,
  onConditionChange,
  onAdd,
  onRemove,
  labels,
  operatorLabels,
  preview,
  className
}: RuleBuilderProps) {
  return (
    <fieldset className={cx("ps-rules", className)}>
      <legend className="ps-rules__legend">{label}</legend>

      <Segmented
        label={label}
        value={combinator}
        onChange={(next) => onCombinatorChange(next as RuleCombinator)}
        options={[
          { value: "and", label: labels.and },
          { value: "or", label: labels.or }
        ]}
      />

      {conditions.length === 0 ? (
        <p className="ps-rules__empty">
          <Icon name="info" size="sm" />
          <span>{labels.empty}</span>
        </p>
      ) : null}

      <ol className="ps-rules__list">
        {conditions.map((condition) => {
          const field = fields.find((option) => option.value === condition.field) ?? fields[0];
          const invalid = condition.value.trim().length === 0;
          return (
            <li key={condition.id} className="ps-rules__row">
              <Select
                label={labels.field}
                value={condition.field}
                onChange={(event) => {
                  const nextField = fields.find((option) => option.value === event.target.value);
                  // Changing the field can strand an operator it does not
                  // support, so the operator resets with it rather than
                  // silently becoming invalid.
                  onConditionChange(condition.id, {
                    field: event.target.value,
                    operator: nextField?.operators[0] ?? condition.operator,
                    value: ""
                  });
                }}
                options={fields.map((option) => ({ value: option.value, label: option.label }))}
              />

              <Select
                label={labels.operator}
                value={condition.operator}
                onChange={(event) => onConditionChange(condition.id, { operator: event.target.value })}
                options={(field?.operators ?? []).map((operator) => ({
                  value: operator,
                  label: operatorLabels[operator] ?? operator
                }))}
              />

              {field?.type === "enum" ? (
                <Select
                  label={labels.value}
                  value={condition.value}
                  error={invalid ? labels.valueRequired : undefined}
                  onChange={(event) => onConditionChange(condition.id, { value: event.target.value })}
                  options={field.choices ?? []}
                />
              ) : (
                <TextField
                  label={labels.value}
                  type={field?.type === "date" ? "date" : "text"}
                  inputMode={field?.type === "number" ? "decimal" : undefined}
                  forceLtr={field?.type !== "text"}
                  value={condition.value}
                  error={invalid ? labels.valueRequired : undefined}
                  onChange={(event) => onConditionChange(condition.id, { value: event.target.value })}
                />
              )}

              <Button variant="ghost" size="sm" onClick={() => onRemove(condition.id)}>
                {labels.remove}
              </Button>
            </li>
          );
        })}
      </ol>

      <Button variant="ghost" size="sm" leadingIcon={<Icon name="plus" size="sm" />} onClick={onAdd}>
        {labels.add}
      </Button>

      {preview ? <div className="ps-rules__preview">{preview}</div> : null}

      {conditions.length > 0 && !isRuleValid(conditions) ? (
        <InlineError>{labels.valueRequired}</InlineError>
      ) : null}
    </fieldset>
  );
}
