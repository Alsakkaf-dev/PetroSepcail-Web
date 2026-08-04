"use client";

import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { useFieldIds } from "./Field";

export interface QtyStepperProps {
  /** Accessible name — "الكمية" plus the line item it belongs to, since a
   * cart has many and "Quantity" alone identifies none of them. */
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Localized names for the two buttons, e.g. "زيادة" / "إنقاص". */
  increaseLabel: string;
  decreaseLabel: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Quantity control for a cart line, a van load-out row, a return line.
 *
 * Both buttons and the field itself are ≥44px, because this is the control a
 * driver uses one-handed in a van. The typed value is clamped on change
 * rather than rejected, so a paste of "500" against a max of 99 lands on 99
 * instead of silently doing nothing.
 *
 * The buttons are `type="button"`: inside a checkout form, a bare `<button>`
 * would submit the order every time someone bumped a quantity. */
export function QtyStepper({
  label,
  value,
  onChange,
  min = 1,
  max = 99,
  increaseLabel,
  decreaseLabel,
  disabled = false,
  id,
  className
}: QtyStepperProps) {
  const ids = useFieldIds(id);
  const clamp = (n: number) => Math.min(Math.max(n, min), max);
  const atMin = value <= min;
  const atMax = value >= max;

  return (
    <div className={cx("ps-qty", className)}>
      <label className="ps-visually-hidden" htmlFor={ids.inputId}>
        {label}
      </label>
      <button
        type="button"
        className="ps-qty__button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || atMin}
        aria-label={decreaseLabel}
      >
        <Icon name="minus" size="sm" />
      </button>
      <input
        id={ids.inputId}
        type="number"
        inputMode="numeric"
        className="ps-qty__input ps-ltr"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          onChange(Number.isNaN(parsed) ? min : clamp(parsed));
        }}
      />
      <button
        type="button"
        className="ps-qty__button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || atMax}
        aria-label={increaseLabel}
      >
        <Icon name="plus" size="sm" />
      </button>
    </div>
  );
}
