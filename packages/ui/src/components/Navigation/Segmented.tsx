"use client";

import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps {
  /** Names the group — "ترتيب المسار", "نوع الحساب". */
  label: string;
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  /** Fills the available width — right for a two-option control at the top
   * of a phone screen. */
  block?: boolean;
  className?: string;
}

/** A small, always-visible choice between two or three views: the login
 * role picker, the manifest's route-order toggle, a period switch.
 *
 * `role="radiogroup"` rather than tabs, because it selects a *value* rather
 * than revealing a panel — and rather than a `<select>`, because with three
 * options a picker hides the choice behind a tap for no gain.
 *
 * The options carry `aria-checked` and stay in the tab order, so the control
 * reads as one group with a current value. */
export function Segmented({ label, options, value, onChange, block = false, className }: SegmentedProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("ps-segmented", block && "ps-segmented--block", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            className={cx("ps-segmented__option", selected && "ps-segmented__option--selected")}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
