import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface AppShellProps {
  /** The persistent bar. Sticks to the top of the viewport. */
  header?: ReactNode;
  /** A `<SideRail>` for the dense consoles. Absent on the storefront and the
   * driver PWA, which navigate from the header alone. */
  sidebar?: ReactNode;
  footer?: ReactNode;
  /** `app` is the dense default. `brochure` lets the storefront's full-bleed
   * sections run edge to edge under the header. */
  width?: "standard" | "wide" | "flush";
  children: ReactNode;
  className?: string;
}

/** The frame every screen in every app sits in: header, optional side rail,
 * content, footer — in that source order, so a keyboard user meets them in
 * the order they are drawn.
 *
 * The shell owns the page's minimum height (`100dvh`, not `100vh`, so a
 * phone's collapsing address bar doesn't leave a strip of background under
 * the footer) and pins the footer to the bottom of a short screen. Screens
 * themselves own nothing structural — they render a `<Page>` into `children`
 * and stay ignorant of whether this app has a rail. */
export function AppShell({ header, sidebar, footer, width = "standard", children, className }: AppShellProps) {
  return (
    <div className={cx("ps-shell", className)}>
      {header}
      <div className={cx("ps-shell__body", Boolean(sidebar) && "ps-shell__body--railed", `ps-shell__body--${width}`)}>
        {sidebar ? <div className="ps-shell__rail">{sidebar}</div> : null}
        <div className="ps-shell__content">{children}</div>
      </div>
      {footer}
    </div>
  );
}
