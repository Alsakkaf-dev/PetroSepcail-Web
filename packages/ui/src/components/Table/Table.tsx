import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { EmptyState } from "../EmptyState/EmptyState";
import { LoadingState } from "../LoadingState/LoadingState";
import { ErrorState } from "../ErrorState/ErrorState";
import "./Table.css";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export type TableState = "ready" | "loading" | "empty" | "error";

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  state?: TableState;
  emptyTitle?: string;
  emptyDescription?: string;
  errorMessage?: string;
  onRetry?: () => void;
  caption?: string;
}

/** PC-08 core set. Wraps in `.ps-table-scroll` (site convention: wide content
 * scrolls inside, the page never does) and folds in the four universal
 * states (PC-08 §3) so consumers don't hand-wire them per screen. */
export function Table<T>({
  columns,
  rows,
  getRowKey,
  state = "ready",
  emptyTitle = "No data",
  emptyDescription,
  errorMessage = "SERVER_ERROR",
  onRetry,
  caption
}: TableProps<T>) {
  if (state === "loading") {
    return <LoadingState lines={5} label={caption ? `Loading ${caption}` : "Loading"} />;
  }
  if (state === "error") {
    return <ErrorState message={errorMessage} onRetry={onRetry} />;
  }
  if (state === "empty" || rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="ps-table-scroll">
      <table className="ps-table">
        {caption ? <caption className="ps-table__caption">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((col) => (
                <td key={col.key} className={cx("ps-table__cell")}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
