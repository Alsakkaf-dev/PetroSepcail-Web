"use client";

import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { cx } from "../../utils/cx";
import { describedBy, FieldShell, useFieldIds } from "../Form/Field";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  hint?: string;
  /** Rendered from the PC-04 §8 error registry; presence also sets aria-invalid. */
  error?: string;
  /** Numerals/phone/technical codes always render LTR even inside an RTL
   * document (PC-08 §1 site behavior) — e.g. email, phone, SKU fields. */
  forceLtr?: boolean;
}

/** PC-08 core set — single-line input.
 *
 * Shares the label/hint/error shell with every other control in the system,
 * so the four of them cannot drift apart. The hint now stays visible beside
 * an error rather than being replaced by it: hiding the format hint at
 * exactly the moment someone got the format wrong is backwards. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, forceLtr = false, id, className, required, ...rest },
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
      <input
        ref={ref}
        id={ids.inputId}
        className={cx("ps-field__input", forceLtr && "ps-ltr")}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy(ids, hint, error)}
        required={required}
        {...rest}
      />
    </FieldShell>
  );
});
