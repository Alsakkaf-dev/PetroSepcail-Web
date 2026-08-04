import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export interface InlineErrorProps {
  /** Wire this into the field's `aria-describedby` — an error a screen
   * reader can't associate with its input is an error nobody heard. */
  id?: string;
  children: ReactNode;
  className?: string;
}

/** A validation message under a single form field.
 *
 * The text comes from the API error registry or from the dictionary, never
 * from an exception: `NOT_LOGGED_IN`, `GET /api/v1/cart failed: 500` and a
 * bare `"failed"` are all banned from the surface (design language §3.5).
 *
 * `role="alert"` so it is announced when it appears, and an icon alongside
 * the `--danger` text so the message is not carried by colour alone. */
export function InlineError({ id, children, className }: InlineErrorProps) {
  return (
    <p id={id} role="alert" className={cx("ps-inline-error", className)}>
      <Icon name="alert" size="sm" />
      <span>{children}</span>
    </p>
  );
}
