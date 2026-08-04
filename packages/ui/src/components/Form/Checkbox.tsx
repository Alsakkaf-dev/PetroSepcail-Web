"use client";

import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { useFieldIds } from "./Field";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  /** Secondary line under the label — the place for a consent explanation or
   * the exact wording of an attestation. */
  description?: ReactNode;
  error?: string;
}

/** A real `<input type="checkbox">` with a drawn box on top.
 *
 * The input keeps its native semantics and keyboard behaviour and is what
 * assistive tech reads; the visible box is `aria-hidden` decoration. The
 * whole row is the label, so the tap target is the row rather than a 16px
 * square — which matters most on the driver's phone.
 *
 * Consent and attestation checkboxes must never be pre-checked (PDPL), so
 * there is deliberately no `defaultChecked` convenience here beyond what the
 * native input already offers. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, error, id, className, ...rest },
  ref
) {
  const ids = useFieldIds(id);
  return (
    <div className={cx("ps-choice", error && "ps-choice--invalid", className)}>
      <label className="ps-choice__row" htmlFor={ids.inputId}>
        <input
          ref={ref}
          id={ids.inputId}
          type="checkbox"
          className="ps-choice__input"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={cx(description ? ids.hintId : undefined, error ? ids.errorId : undefined) || undefined}
          {...rest}
        />
        <span className="ps-choice__box ps-choice__box--check" aria-hidden="true">
          <Icon name="check" size="sm" />
        </span>
        <span className="ps-choice__text">
          <span className="ps-choice__label">{label}</span>
          {description ? (
            <span id={ids.hintId} className="ps-choice__description">
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p id={ids.errorId} className="ps-field__error" role="alert">
          <Icon name="alert" size="sm" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
});
