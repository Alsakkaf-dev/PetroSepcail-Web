import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export interface BreadcrumbItem {
  label: string;
  /** Omitted on the last crumb — the page you are already on is not a link. */
  href?: string;
}

export interface BreadcrumbProps {
  /** Names the landmark, e.g. "مسار التنقل". */
  label: string;
  items: BreadcrumbItem[];
  className?: string;
}

/** Where this screen sits — catalog → family → product, invoices → invoice.
 *
 * An ordered list inside a `<nav>`, with the current page marked
 * `aria-current` and the separators hidden from assistive tech: a screen
 * reader should hear the trail, not four chevrons. The chevron is
 * directional, so the trail runs the right way in both languages. */
export function Breadcrumb({ label, items, className }: BreadcrumbProps) {
  return (
    <nav aria-label={label} className={cx("ps-breadcrumb", className)}>
      <ol className="ps-breadcrumb__list">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="ps-breadcrumb__item">
              {index > 0 ? <Icon name="chevron-forward" size="sm" className="ps-breadcrumb__separator" /> : null}
              {item.href && !last ? (
                <a href={item.href} className="ps-breadcrumb__link">
                  {item.label}
                </a>
              ) : (
                <span className="ps-breadcrumb__current" aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
