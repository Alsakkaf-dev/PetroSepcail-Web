import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../../utils/cx";
import "./Button.css";

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
