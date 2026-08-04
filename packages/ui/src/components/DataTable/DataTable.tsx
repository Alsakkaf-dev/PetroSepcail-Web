"use client";

import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { EmptyState } from "../EmptyState/EmptyState";
import { LoadingState } from "../LoadingState/LoadingState";
import { ErrorState } from "../ErrorState/ErrorState";

export type SortDirection = "asc" | "desc";

export interface DataTableSort {
  key: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Sorting is server-side — the component reports the intent and the page
   * refetches. A table that sorts only the page it happens to be showing is
   * lying about the other pages. */
  sortable?: boolean;
  /** `end` for money and counts, so figures line up on their last digit. */
  align?: "start" | "end";
  /** `primary` columns head the card on a phone; `secondary` ones become its
   * label/value rows. Nothing is hidden — a column a screen chose to show is
   * a column someone needs. */
  emphasis?: "primary" | "secondary";
  /** Column header for a control column — announced, never displayed. */
  headerHidden?: boolean;
}

export type DataTableState = "ready" | "loading" | "empty" | "error";

export interface DataTableProps<T> {
  /** Names the table for assistive tech. Required: "Table" is not a name. */
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  state?: DataTableState;
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;
  /** Localized "sorted ascending"/"sorted descending" for the sort control. */
  sortLabels?: { asc: string; desc: string };
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** From the API error registry — never a raw exception string. */
  errorMessage?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Keeps the header visible while a long result set scrolls under it. */
  stickyHeader?: boolean;
  /** Rendered under the table — normally a <Pagination>. */
  footer?: ReactNode;
  className?: string;
}

function nextDirection(current: DataTableSort | undefined, key: string): SortDirection {
  if (current?.key !== key) return "asc";
  return current.direction === "asc" ? "desc" : "asc";
}

/** The replacement for every raw `<table>` in the apps.
 *
 * Carries all four universal states itself, so no screen re-wires loading,
 * empty and error around a table for the seventeenth time.
 *
 * On a phone the CSS flattens each row into a card, with every cell carrying
 * its own column label. Flattening a table with `display: block` normally
 * strips its semantics from assistive tech, so the ARIA roles are declared
 * explicitly and survive the change — one DOM tree, correct in both layouts,
 * rather than a table and a duplicate list of cards.
 *
 * Sorting is reported, not performed: the page refetches. Sorting only the
 * rows currently on screen would quietly misrepresent every other page. */
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  state = "ready",
  sort,
  onSortChange,
  sortLabels,
  emptyTitle = "No data",
  emptyDescription,
  emptyAction,
  errorMessage = "SERVER_ERROR",
  onRetry,
  retryLabel,
  stickyHeader = true,
  footer,
  className
}: DataTableProps<T>) {
  if (state === "loading") {
    return <LoadingState lines={6} label={caption} />;
  }
  if (state === "error") {
    return <ErrorState message={errorMessage} onRetry={onRetry} retryLabel={retryLabel} />;
  }
  if (state === "empty" || rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <div className={cx("ps-datatable", className)}>
      <div className="ps-datatable__scroll">
        <table className="ps-datatable__table" role="table">
          <caption className="ps-datatable__caption">{caption}</caption>
          <thead className={cx("ps-datatable__head", stickyHeader && "ps-datatable__head--sticky")}>
            <tr role="row">
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    role="columnheader"
                    className={cx(`ps-datatable__th--${column.align ?? "start"}`)}
                    aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        className="ps-datatable__sort"
                        onClick={() => onSortChange({ key: column.key, direction: nextDirection(sort, column.key) })}
                      >
                        <span className={cx(column.headerHidden && "ps-visually-hidden")}>{column.header}</span>
                        <Icon
                          name={active ? (sort.direction === "asc" ? "chevron-up" : "chevron-down") : "sort"}
                          size="sm"
                        />
                        {active && sortLabels ? (
                          <span className="ps-visually-hidden">{sortLabels[sort.direction]}</span>
                        ) : null}
                      </button>
                    ) : (
                      <span className={cx(column.headerHidden && "ps-visually-hidden")}>{column.header}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((row) => (
              <tr key={getRowKey(row)} role="row" className="ps-datatable__row">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    role="cell"
                    // Read by the stacked-card layout's ::before, so a cell on
                    // a phone still says which column it belongs to.
                    data-label={column.header}
                    className={cx(
                      "ps-datatable__cell",
                      `ps-datatable__cell--${column.align ?? "start"}`,
                      column.emphasis && `ps-datatable__cell--${column.emphasis}`
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer ? <div className="ps-datatable__footer">{footer}</div> : null}
    </div>
  );
}
