"use client";

import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cx } from "../../utils/cx";
import { describedBy, FieldShell, useFieldIds } from "./Field";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Current length and the cap, already localized, e.g. "٢٤ / ١٠٠٠". Shown
   * beside the field and announced politely — a review capped at 1000
   * characters has to say so before the user hits the wall, not after. */
  counter?: string;
}

/** Multi-line input: a return reason, an intervention note, a review body. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, counter, id, className, required, rows = 4, ...rest },
  ref
) {
  const ids = useFieldIds(id);
  return (
    <FieldShell
      label={label}
      htmlFor={ids.inputId}
      required={required}
      hint={hint}
      error={error}
      ids={ids}
      className={className}
    >
      <textarea
        ref={ref}
        id={ids.inputId}
        rows={rows}
        className={cx("ps-field__input", "ps-textarea")}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy(ids, hint, error)}
        required={required}
        {...rest}
      />
      {counter ? (
        <p className="ps-textarea__counter" aria-live="polite">
          {counter}
        </p>
      ) : null}
    </FieldShell>
  );
});
