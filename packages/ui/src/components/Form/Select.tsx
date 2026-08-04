"use client";

import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { Icon } from "../../icons";
import { describedBy, FieldShell, useFieldIds } from "./Field";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label: string;
  options: SelectOption[];
  hint?: string;
  /** Localized, from the API error registry or the dictionary. */
  error?: string;
  /** Renders a disabled first option — a real placeholder, not a fake empty
   * value that submits as one. */
  placeholder?: string;
}

/** A native `<select>`, on purpose.
 *
 * A custom listbox is a lot of ARIA to get wrong, and the native control
 * already gives keyboard support, a mobile picker sized for a thumb, and
 * correct behaviour in RTL for free. Where a screen genuinely needs search or
 * multi-select, that is Combobox's job, not this one's. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, hint, error, placeholder, id, className, required, ...rest },
  ref
) {
  const ids = useFieldIds(id);
  return (
    <FieldShell label={label} htmlFor={ids.inputId} required={required} hint={hint} error={error} ids={ids} className={className}>
      <span className="ps-select">
        <select
          ref={ref}
          id={ids.inputId}
          className="ps-select__control"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy(ids, hint, error)}
          required={required}
          defaultValue={placeholder && rest.value === undefined && rest.defaultValue === undefined ? "" : undefined}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        {/* Decorative: the native control already announces itself. */}
        <Icon name="chevron-down" size="sm" className="ps-select__chevron" />
      </span>
    </FieldShell>
  );
});
