"use client";

import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { useFieldIds } from "./Field";

export interface KeypadProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  /** Digits expected — 4 for a delivery OTP. */
  length?: number;
  /** Localized name for the delete key. */
  deleteLabel: string;
  /** Localized announcement of progress, e.g. "٢ من ٤ أرقام". */
  status?: string;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"] as const;

/** The large on-screen keypad for a delivery OTP.
 *
 * A driver enters this one-handed, in daylight, sometimes in gloves, so the
 * keys are big rather than tidy. The digits and the filled cells are forced
 * LTR: an OTP is a technical string and reads left to right in Arabic exactly
 * as it does in English.
 *
 * The filled cells are a picture of the value, so they are `aria-hidden` and
 * the real value lives in one input the field is labelled by — otherwise a
 * screen reader announces four unlabelled boxes and no code. */
export function Keypad({
  label,
  value,
  onChange,
  length = 4,
  deleteLabel,
  status,
  error,
  disabled = false,
  id,
  className
}: KeypadProps) {
  const ids = useFieldIds(id);
  const press = (key: string) => {
    if (disabled) return;
    if (key === "delete") {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= length) return;
    onChange(`${value}${key}`);
  };

  return (
    <div className={cx("ps-keypad", error && "ps-keypad--invalid", className)}>
      <label className="ps-keypad__label" htmlFor={ids.inputId}>
        {label}
      </label>
      {/* Read-only rather than disabled: a disabled input is skipped by
          assistive tech, and this is the element carrying the value. */}
      <input
        id={ids.inputId}
        className="ps-visually-hidden"
        value={value}
        readOnly
        inputMode="numeric"
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? ids.errorId : undefined}
      />
      <div className="ps-keypad__cells" aria-hidden="true">
        {Array.from({ length }, (_, index) => (
          <span key={index} className={cx("ps-keypad__cell", index < value.length && "ps-keypad__cell--filled")}>
            <span className="ps-ltr">{value[index] ?? ""}</span>
          </span>
        ))}
      </div>
      {status ? (
        <p className="ps-keypad__status" aria-live="polite">
          {status}
        </p>
      ) : null}
      <div className="ps-keypad__keys">
        {KEYS.map((key, index) =>
          key === "" ? (
            <span key={`gap-${index}`} className="ps-keypad__gap" />
          ) : (
            <button
              key={key}
              type="button"
              className={cx("ps-keypad__key", key === "delete" && "ps-keypad__key--delete")}
              onClick={() => press(key)}
              disabled={disabled}
              aria-label={key === "delete" ? deleteLabel : undefined}
            >
              {key === "delete" ? <Icon name="arrow-back" size="md" /> : <span className="ps-ltr">{key}</span>}
            </button>
          )
        )}
      </div>
      {error ? (
        <p id={ids.errorId} className="ps-field__error" role="alert">
          <Icon name="alert" size="sm" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
