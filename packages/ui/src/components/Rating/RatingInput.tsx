"use client";

import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { describedBy, FieldShell, useFieldIds } from "../Form/Field";
import { STAR_VALUES } from "./Rating";

export interface RatingInputProps {
  label: string;
  /** Shared across the five inputs; this is what makes them one choice. */
  name: string;
  value?: number;
  onChange?: (value: number) => void;
  /** "1 نجمة" … "5 نجوم" — one per star, in order. Each radio needs a real
   * name of its own; a star with no label is a control nobody can pick by
   * voice, by screen reader, or from a list of form fields. */
  starLabels: readonly [string, string, string, string, string];
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Pick a rating, 1 to 5.
 *
 * Five real radios in a real `<fieldset>` — so arrow keys move between them,
 * the group has a name, and the choice submits with the form. The stars are
 * drawn on top of the inputs, never in place of them: a row of `<button>`s
 * would look identical and answer to none of that.
 */
export function RatingInput({
  label,
  name,
  value,
  onChange,
  starLabels,
  hint,
  error,
  required,
  disabled,
  id,
  className
}: RatingInputProps) {
  const ids = useFieldIds(id);
  return (
    <FieldShell
      as="fieldset"
      label={label}
      required={required}
      hint={hint}
      error={error}
      ids={ids}
      className={cx("ps-rating-input", className)}
    >
      <div className="ps-rating-input__stars" aria-describedby={describedBy(ids, hint, error)}>
        {STAR_VALUES.map((star) => {
          const optionId = `${ids.inputId}-${star}`;
          const on = value !== undefined && star <= value;
          return (
            <label
              key={star}
              className={cx("ps-rating-input__option", on && "ps-rating-input__option--on")}
              htmlFor={optionId}
            >
              <input
                id={optionId}
                type="radio"
                name={name}
                value={star}
                className="ps-choice__input"
                checked={value === undefined ? undefined : value === star}
                disabled={disabled}
                required={required}
                onChange={onChange ? () => onChange(star) : undefined}
              />
              <span className="ps-rating-input__star" aria-hidden="true">
                <Icon name="star" size="lg" />
              </span>
              <span className="ps-visually-hidden">{starLabels[star - 1]}</span>
            </label>
          );
        })}
      </div>
    </FieldShell>
  );
}
