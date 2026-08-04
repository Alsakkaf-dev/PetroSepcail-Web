"use client";

import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { describedBy, FieldShell, useFieldIds } from "./Field";

export interface RadioOption {
  value: string;
  label: ReactNode;
  /** Secondary line — a delivery-slot window, why a payment method is
   * unavailable, what a reason code actually means. */
  description?: ReactNode;
  disabled?: boolean;
  /** Shown at the end of the row: "قريباً" on the dormant online-payment
   * option, a price on a delivery slot. */
  trailing?: ReactNode;
}

export interface RadioGroupProps {
  label: string;
  /** Shared across the group's inputs; this is what makes them one choice. */
  name: string;
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
  id?: string;
  className?: string;
}

/** One choice from a small, fully-visible set: payment method, delivery slot,
 * reason code, refund destination.
 *
 * Renders a real `<fieldset>`/`<legend>`, so the group has a name and arrow
 * keys move between options — the behaviour a screen reader user expects and
 * the reason this is not a stack of buttons.
 *
 * A disabled option stays *visible*: "Online payment — قريباً" has to be
 * seen and understood, not hidden, and an illegal action is absent only when
 * it is genuinely not part of the flow. */
export function RadioGroup({
  label,
  name,
  options,
  value,
  onChange,
  hint,
  error,
  required,
  id,
  className
}: RadioGroupProps) {
  const ids = useFieldIds(id);
  return (
    <FieldShell
      as="fieldset"
      label={label}
      required={required}
      hint={hint}
      error={error}
      ids={ids}
      className={cx("ps-radio-group", className)}
    >
      <div className="ps-radio-group__options" aria-describedby={describedBy(ids, hint, error)}>
        {options.map((option) => {
          const optionId = `${ids.inputId}-${option.value}`;
          return (
            <label
              key={option.value}
              className={cx("ps-choice__row", "ps-radio", option.disabled && "ps-radio--disabled")}
              htmlFor={optionId}
            >
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option.value}
                className="ps-choice__input"
                checked={value === undefined ? undefined : value === option.value}
                disabled={option.disabled}
                required={required}
                onChange={onChange ? () => onChange(option.value) : undefined}
              />
              <span className="ps-choice__box ps-choice__box--radio" aria-hidden="true">
                <span className="ps-choice__dot" />
              </span>
              <span className="ps-choice__text">
                <span className="ps-choice__label">{option.label}</span>
                {option.description ? <span className="ps-choice__description">{option.description}</span> : null}
              </span>
              {option.trailing ? <span className="ps-radio__trailing">{option.trailing}</span> : null}
              {option.disabled ? <Icon name="lock" size="sm" className="ps-radio__lock" /> : null}
            </label>
          );
        })}
      </div>
    </FieldShell>
  );
}
