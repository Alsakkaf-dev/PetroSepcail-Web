"use client";

import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { describedBy, FieldShell, useFieldIds } from "./Field";

export interface RangeSliderProps {
  label: string;
  value: number;
  /** Almost always 0 — "use no points" has to stay reachable. */
  min?: number;
  /** The ceiling, and the whole point of this control: the server's own cap.
   * The slider physically cannot be dragged past it, which is a stronger
   * guarantee than validating a typed number after the fact. */
  max: number;
  step?: number;
  onChange: (next: number) => void;
  /** What a screen reader says instead of the bare number — "300 points,
   * SAR 15 off". Without it the control announces "300" and leaves the
   * listener to guess what 300 of anything means. */
  valueText?: string;
  /** The same fact, on screen, under the track. */
  readout?: ReactNode;
  /** Where the ceiling comes from, in words: "you can use up to 400 points
   * (SAR 20) on this order". */
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * A bounded numeric choice: loyalty points to redeem at checkout, a price
 * ceiling on a filter rail.
 *
 * Built for SCR-LE07-001, where the bound is not a design preference but a
 * rule — the redemption cap is `min(balance, 50% of the order)` and it is
 * quoted by the server (EP-X-003), never computed here. Passing that quote in
 * as `max` is what makes the cap visible, operable and announced rather than
 * an error someone discovers after submitting.
 *
 * The value is also shown as text beside the track, because a slider alone
 * tells you roughly how far along you are and nothing about what you chose.
 */
export function RangeSlider({
  label,
  value,
  min = 0,
  max,
  step = 1,
  onChange,
  valueText,
  readout,
  hint,
  error,
  disabled = false,
  id,
  className
}: RangeSliderProps) {
  const ids = useFieldIds(id);
  const safeMax = Math.max(max, min);
  const clamped = Math.min(Math.max(value, min), safeMax);

  return (
    <FieldShell label={label} htmlFor={ids.inputId} hint={hint} error={error} ids={ids} className={className}>
      <div className="ps-range">
        <input
          id={ids.inputId}
          type="range"
          className={cx("ps-range__input")}
          value={clamped}
          min={min}
          max={safeMax}
          step={step}
          disabled={disabled || safeMax === min}
          aria-valuetext={valueText}
          aria-describedby={describedBy(ids, hint, error)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {readout ? (
          <p className="ps-range__readout" aria-hidden="true">
            {readout}
          </p>
        ) : null}
      </div>
    </FieldShell>
  );
}
