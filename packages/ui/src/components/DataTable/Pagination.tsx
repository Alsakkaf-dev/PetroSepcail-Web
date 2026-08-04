"use client";

import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Names the navigation landmark, e.g. "صفحات الفواتير" — a page with two
   * paginated tables otherwise has two landmarks called "pagination". */
  label: string;
  previousLabel: string;
  nextLabel: string;
  /** Already localized and formatted, e.g. "٣ من ١٢" / "3 of 12". Formatting
   * lives in packages/i18n, not here. */
  status?: string;
  /** Localized "صفحة {n}" template for a numbered button's accessible name. */
  pageLabel?: (page: number) => string;
  className?: string;
}

/** How many numbered buttons to show around the current page. Seven keeps
 * the control inside 360px with both arrows and two ellipses. */
const WINDOW = 2;

function pageWindow(page: number, pageCount: number): number[] {
  const pages = new Set<number>([1, pageCount]);
  for (let p = page - WINDOW; p <= page + WINDOW; p += 1) {
    if (p >= 1 && p <= pageCount) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Pagination for a DataTable or a result grid.
 *
 * The arrows use directional glyphs, so "next" points left in Arabic and
 * right in English without a second code path. The current page is marked
 * `aria-current`, which is what tells a screen reader where it is — the
 * highlight alone says nothing. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  label,
  previousLabel,
  nextLabel,
  status,
  pageLabel,
  className
}: PaginationProps) {
  if (pageCount <= 1) return null;
  const pages = pageWindow(page, pageCount);

  return (
    <nav className={cx("ps-pagination", className)} aria-label={label}>
      <button
        type="button"
        className="ps-pagination__arrow"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label={previousLabel}
      >
        <Icon name="chevron-back" size="sm" />
      </button>
      <ul className="ps-pagination__pages">
        {pages.map((p, index) => {
          const previous = pages[index - 1];
          const gap = previous !== undefined && p - previous > 1;
          return (
            <li key={p} className="ps-pagination__item">
              {gap ? (
                <span className="ps-pagination__gap" aria-hidden="true">
                  …
                </span>
              ) : null}
              <button
                type="button"
                className={cx("ps-pagination__page", p === page && "ps-pagination__page--current")}
                onClick={() => onPageChange(p)}
                aria-current={p === page ? "page" : undefined}
                aria-label={pageLabel?.(p)}
              >
                <span className="ps-ltr">{p}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="ps-pagination__arrow"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        aria-label={nextLabel}
      >
        <Icon name="chevron-forward" size="sm" />
      </button>
      {status ? (
        <p className="ps-pagination__status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </nav>
  );
}
