import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface AuthShellProps {
  /** A `<Brand>`, sitting above the card rather than inside it. */
  brand?: ReactNode;
  title: ReactNode;
  /** One sentence saying who this door is for — the only thing that differs
   * between the four portals' sign-in screens. */
  lead?: ReactNode;
  children: ReactNode;
  /** Sign-up / reset links, or the "this console is monitored" line. */
  footer?: ReactNode;
  /** `page` owns the whole viewport — a dedicated `/login` route. `panel`
   * drops the full-height backdrop and sits inside a screen that is already
   * inside the app chrome: the storefront's cart/orders/account gates and the
   * admin console's, which have no sign-in route of their own. */
  variant?: "page" | "panel";
  className?: string;
}

/** The screen behind every sign-in, on all four apps.
 *
 * The card is capped at 26rem (`SCR-PC01-001`) and, crucially, its contents
 * are allowed to shrink: the driver login shipped an input row that overflowed
 * the viewport horizontally on a phone, which is what an unconstrained flex
 * row of fixed-width inputs does. Everything here is a block-flow column with
 * `min-inline-size: 0`, so there is no width for content to overflow.
 *
 * The mark sits outside the card so the card is only the form — a person
 * looking for the password field finds a box with a password field in it. */
export function AuthShell({ brand, title, lead, children, footer, variant = "page", className }: AuthShellProps) {
  // On a dedicated /login route this *is* the screen, so it is the document's
  // <main> and the skip link's target — without that the skip link at the top
  // of every page in the platform would point at nothing here. As a panel it
  // sits inside a screen that already has one.
  const Root = variant === "page" ? "main" : "div";
  const rootProps = variant === "page" ? { id: "main", tabIndex: -1 } : {};

  return (
    <Root {...rootProps} className={cx("ps-auth", `ps-auth--${variant}`, className)}>
      <div className="ps-auth__decor" aria-hidden="true" />
      <div className="ps-auth__inner">
        {brand ? <div className="ps-auth__brand">{brand}</div> : null}
        <div className="ps-auth__card">
          <div className="ps-auth__head">
            <h1 className="ps-auth__title">{title}</h1>
            {lead ? <p className="ps-auth__lead">{lead}</p> : null}
          </div>
          {children}
        </div>
        {footer ? <div className="ps-auth__footer">{footer}</div> : null}
      </div>
    </Root>
  );
}
