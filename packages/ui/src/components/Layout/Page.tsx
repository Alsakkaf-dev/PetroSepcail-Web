import type { HTMLAttributes } from "react";
import { cx } from "../../utils/cx";

export interface PageProps extends HTMLAttributes<HTMLElement> {
  /** Matches Container's ramp. `wide` for dense admin/supplier tables,
   * `narrow` for a single readable column, `flush` for a screen that manages
   * its own full-bleed sections. */
  width?: "standard" | "wide" | "narrow" | "flush";
  /** `app` is the dense default. `brochure` opens up to --section-pad, for
   * the storefront's marketing-adjacent pages. */
  air?: "app" | "brochure";
}

/** The `<main>` landmark every screen sits in — one per document.
 *
 * `tabIndex={-1}` is not decoration: without it the skip link moves the
 * viewport but not focus in WebKit, so a keyboard user lands back at the top
 * of the navigation on the next Tab. */
export function Page({ width = "standard", air = "app", id = "main", className, children, ...rest }: PageProps) {
  return (
    <main
      id={id}
      tabIndex={-1}
      className={cx("ps-page", `ps-page--${width}`, `ps-page--air-${air}`, className)}
      {...rest}
    >
      {children}
    </main>
  );
}

export interface SkipLinkProps {
  label: string;
  /** Defaults to Page's own id. */
  targetId?: string;
  className?: string;
}

/** First focusable thing in the document, per screen. Visually hidden until
 * focused; the styling lives in tokens/base.css so it exists in all four apps
 * whether or not they have adopted the component layer yet. */
export function SkipLink({ label, targetId = "main", className }: SkipLinkProps) {
  return (
    <a href={`#${targetId}`} className={cx("ps-skip-link", className)}>
      {label}
    </a>
  );
}
