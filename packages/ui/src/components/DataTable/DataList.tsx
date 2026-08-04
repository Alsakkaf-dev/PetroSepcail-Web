"use client";

import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { EmptyState } from "../EmptyState/EmptyState";
import { LoadingState } from "../LoadingState/LoadingState";
import { ErrorState } from "../ErrorState/ErrorState";

export interface DataListField {
  label: string;
  value: ReactNode;
}

export interface DataListItem {
  id: string;
  /** The heading of the row — an order reference, a stop name, a product. */
  title: ReactNode;
  /** Usually a StatusBadge. Sits at the end of the title line. */
  status?: ReactNode;
  /** Label/value pairs; rendered as a description list, which is what they
   * actually are. */
  fields?: DataListField[];
  /** Buttons for this row. */
  actions?: ReactNode;
  /** Wraps the row in a link — the whole card becomes the target. */
  href?: string;
  /** A start-aligned accent, normally a <FamilyAccent> class. */
  accentClassName?: string;
}

export interface DataListProps {
  /** Names the list. A screen with several lists needs each one named. */
  label: string;
  items: DataListItem[];
  state?: "ready" | "loading" | "empty" | "error";
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  errorMessage?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/** A list of records as cards — orders, stops, returns, parcels.
 *
 * The alternative to DataTable, not a fallback from it: a manifest stop or
 * an order is a record with a handful of named facts, and reading it as a
 * card beats scanning it across eight columns. Where the job really is
 * comparing many rows on the same axis, that is a table and DataTable is
 * right.
 *
 * The facts are a real `<dl>`, so a screen reader pairs each value with its
 * label instead of reading a run of unattached strings. */
export function DataList({
  label,
  items,
  state = "ready",
  emptyTitle = "No data",
  emptyDescription,
  emptyAction,
  errorMessage = "SERVER_ERROR",
  onRetry,
  retryLabel,
  className
}: DataListProps) {
  if (state === "loading") return <LoadingState lines={6} label={label} />;
  if (state === "error") return <ErrorState message={errorMessage} onRetry={onRetry} retryLabel={retryLabel} />;
  if (state === "empty" || items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <ul className={cx("ps-datalist", className)} aria-label={label}>
      {items.map((item) => (
        <li key={item.id} className={cx("ps-datalist__item", item.accentClassName)}>
          <div className="ps-datalist__header">
            <p className="ps-datalist__title">
              {item.href ? (
                <a href={item.href} className="ps-datalist__link">
                  {item.title}
                </a>
              ) : (
                item.title
              )}
            </p>
            {item.status ? <span className="ps-datalist__status">{item.status}</span> : null}
          </div>
          {item.fields?.length ? (
            <dl className="ps-datalist__fields">
              {item.fields.map((field) => (
                <div key={field.label} className="ps-datalist__field">
                  <dt className="ps-datalist__label">{field.label}</dt>
                  <dd className="ps-datalist__value">{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {item.actions ? <div className="ps-datalist__actions">{item.actions}</div> : null}
        </li>
      ))}
    </ul>
  );
}
