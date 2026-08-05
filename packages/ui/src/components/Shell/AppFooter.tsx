import type { ElementType, ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface AppFooterLink {
  href: string;
  label: string;
  /** Opens off-platform (the marketing site, a policy page). Gets the
   * external glyph's affordance without the icon dependency. */
  external?: boolean;
}

export interface AppFooterProps {
  /** A `<Brand>`, usually at `size="sm"`. */
  brand?: ReactNode;
  /** One line under the mark: what this portal is. */
  tagline?: ReactNode;
  links?: AppFooterLink[];
  /** Names the landmark when an app carries more than one footer region. */
  label?: string;
  /** Already localised and bidi-safe — the year is a numeral. */
  legal?: ReactNode;
  linkAs?: ElementType;
  className?: string;
}

/** The quiet end of every screen: the mark again, what this is, the few links
 * that belong everywhere, and the legal line.
 *
 * Deliberately not the marketing site's dark footer — that one is the last
 * moment of a brochure, and an accountant reconciling payments does not need
 * a black slab under the table. Same family, lower voice: a warm recessed
 * surface and a hairline. */
export function AppFooter({ brand, tagline, links, label, legal, linkAs, className }: AppFooterProps) {
  const Link: ElementType = linkAs ?? "a";

  return (
    <footer className={cx("ps-app-footer", className)}>
      <div className="ps-app-footer__inner">
        <div className="ps-app-footer__brand">
          {brand}
          {tagline ? <p className="ps-app-footer__tagline">{tagline}</p> : null}
        </div>
        {links && links.length > 0 ? (
          <nav className="ps-app-footer__nav" aria-label={label}>
            <ul className="ps-app-footer__links">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="ps-app-footer__link"
                    {...(link.external ? { rel: "noreferrer" } : {})}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {legal ? <p className="ps-app-footer__legal">{legal}</p> : null}
      </div>
    </footer>
  );
}
