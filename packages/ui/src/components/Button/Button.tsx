"use client";

import { forwardRef } from "react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ElementType, ReactNode } from "react";
import { cx } from "../../utils/cx";

export type ButtonVariant = "gold" | "ghost" | "dark" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and sets aria-busy; the button stays focusable but inert. */
  busy?: boolean;
  leadingIcon?: ReactNode;
  children: ReactNode;
}

/** PC-08 core set — min touch target 48px (44px at `size="sm"`), token-only
 * colors. `variant="danger"` uses `--flame` as a background (paired with
 * `--ink` text) rather than as foreground text, since `--flame` alone fails
 * WCAG AA for normal-size text (see a11y/contrast.test.ts). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "gold", size = "md", busy = false, leadingIcon, disabled, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      className={cx("ps-btn", `ps-btn--${variant}`, `ps-btn--${size}`, busy && "ps-btn--busy", className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="ps-btn__spinner" aria-hidden="true" /> : leadingIcon}
      <span className="ps-btn__label">{children}</span>
    </button>
  );
});

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  /** `next/link` in an app; a plain anchor everywhere else. */
  linkAs?: ElementType;
  children: ReactNode;
}

/** A navigation that *looks* like the primary action — "Start your shift",
 * "Browse the catalogue", "Back to home".
 *
 * Deliberately a separate component rather than a `href` prop on `Button`:
 * the element decides the semantics, and a control that navigates must be a
 * link (openable in a new tab, announced as a link, activated by Enter) while
 * a control that acts must be a button. Sharing one prop bag is how those two
 * get confused. The class list is identical, so they are visually one thing.
 *
 * `busy` is absent on purpose: a link has nothing to wait for. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "gold", size = "md", leadingIcon, linkAs, className, children, ...rest },
  ref
) {
  const Link: ElementType = linkAs ?? "a";
  return (
    <Link
      ref={ref}
      className={cx("ps-btn", `ps-btn--${variant}`, `ps-btn--${size}`, className)}
      {...rest}
    >
      {leadingIcon}
      <span className="ps-btn__label">{children}</span>
    </Link>
  );
});
