import { forwardRef, useId } from "react";
import type { InputHTMLAttributes } from "react";
import { cx } from "../../utils/cx";
import "./TextField.css";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  hint?: string;
  /** Rendered from the PC-04 §8 error registry; presence also sets aria-invalid. */
  error?: string;
  /** Numerals/phone/technical codes always render LTR even inside an RTL
   * document (PC-08 §1 site behavior) — e.g. email, phone, SKU fields. */
  forceLtr?: boolean;
}

/** PC-08 core set. Label/hint/error states per PC-08 §3's universal states;
 * error text stays `--ink` with a `--flame` accent border/icon slot, since
 * `--flame` alone fails AA for normal-size text (see a11y/contrast.test.ts). */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, forceLtr = false, id, className, required, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={cx("ps-field", error && "ps-field--invalid", className)}>
      <label htmlFor={inputId} className="ps-field__label">
        {label}
        {required ? (
          <span className="ps-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={cx("ps-field__input", forceLtr && "ps-ltr")}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={cx(hintId, errorId) || undefined}
        required={required}
        {...rest}
      />
      {hint && !error ? (
        <p id={hintId} className="ps-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ps-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
