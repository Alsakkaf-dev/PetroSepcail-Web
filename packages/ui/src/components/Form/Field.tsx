"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export interface FieldIds {
  inputId: string;
  hintId: string;
  errorId: string;
}

/** Stable ids for a control and the text describing it. Every control in this
 * folder uses it, so `aria-describedby` wiring is written once instead of
 * once per component — an error a screen reader cannot associate with its
 * input is an error nobody heard. */
export function useFieldIds(id?: string): FieldIds {
  const auto = useId();
  const base = id ?? auto;
  return { inputId: base, hintId: `${base}-hint`, errorId: `${base}-error` };
}

/** What a control passes to `aria-describedby`: the hint, the error, or both.
 *
 * Both, when both are present — the hint says what the field wants and the
 * error says what was wrong with what arrived, and a screen reader user needs
 * the same two facts a sighted user gets. */
export function describedBy(ids: FieldIds, hint?: ReactNode, error?: ReactNode): string | undefined {
  return cx(hint ? ids.hintId : undefined, error ? ids.errorId : undefined) || undefined;
}

export interface FieldShellProps {
  label: ReactNode;
  /** Omit for controls that label themselves (a checkbox, a switch). */
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  ids: FieldIds;
  children: ReactNode;
  /** `fieldset` for a group of related controls — radios, a date range. A
   * group labelled only by a floating `<p>` is a group with no name. */
  as?: "div" | "fieldset";
  /** Hide the label visually while keeping it for assistive tech.
   *
   * For a control inside a table cell whose column header already says what
   * it is, and nowhere else. The label is still rendered and still associated
   * — this moves it out of sight, it does not remove it. */
  hideLabel?: boolean;
  className?: string;
}

/** Label, control, hint, error — in that order, with the wiring done.
 *
 * The error is `--danger`, which clears AA as text. It is deliberately not
 * `--flame`: flame is an alert accent and a background, and the contrast
 * suite asserts it fails AA as foreground text on purpose. */
export function FieldShell({
  label,
  htmlFor,
  required,
  hint,
  error,
  ids,
  children,
  as = "div",
  hideLabel,
  className
}: FieldShellProps) {
  const isGroup = as === "fieldset";
  const Wrapper = as;
  const Label = isGroup ? "legend" : "label";
  return (
    <Wrapper className={cx("ps-field", Boolean(error) && "ps-field--invalid", className)}>
      <Label className={cx("ps-field__label", hideLabel && "ps-visually-hidden")} htmlFor={isGroup ? undefined : htmlFor}>
        {label}
        {required ? (
          <span className="ps-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {hint ? (
        <p id={ids.hintId} className="ps-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={ids.errorId} className="ps-field__error" role="alert">
          <Icon name="alert" size="sm" />
          <span>{error}</span>
        </p>
      ) : null}
    </Wrapper>
  );
}
