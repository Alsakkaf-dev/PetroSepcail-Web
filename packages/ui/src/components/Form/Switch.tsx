"use client";

import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { useFieldIds } from "./Field";

export interface SwitchProps {
  label: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  description?: ReactNode;
  disabled?: boolean;
  /** Some toggles are stated rather than offered — in-app notifications are
   * always on. Rendering the switch on and locked, with the reason beside it,
   * is more honest than hiding it. */
  lockedReason?: ReactNode;
  id?: string;
  className?: string;
}

/** An immediate on/off preference: notification channels, back-in-stock
 * alerts, marketing consent.
 *
 * `role="switch"` rather than a checkbox, because the change takes effect on
 * the spot instead of on submit — and a screen reader should say "on/off",
 * not "checked". A switch that needs a Save button is a checkbox. */
export function Switch({
  label,
  checked,
  onChange,
  description,
  disabled = false,
  lockedReason,
  id,
  className
}: SwitchProps) {
  const ids = useFieldIds(id);
  const locked = Boolean(lockedReason);
  return (
    <div className={cx("ps-switch", (disabled || locked) && "ps-switch--disabled", className)}>
      <button
        type="button"
        role="switch"
        id={ids.inputId}
        aria-checked={checked}
        aria-describedby={cx(description || lockedReason ? ids.hintId : undefined) || undefined}
        disabled={disabled || locked}
        onClick={() => onChange(!checked)}
        className="ps-switch__control"
      >
        <span className="ps-switch__track" aria-hidden="true">
          <span className="ps-switch__thumb" />
        </span>
        <span className="ps-switch__label">{label}</span>
      </button>
      {description || lockedReason ? (
        <p id={ids.hintId} className="ps-switch__description">
          {lockedReason ?? description}
        </p>
      ) : null}
    </div>
  );
}
