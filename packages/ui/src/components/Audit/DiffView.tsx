import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export interface DiffRow {
  /** The field's own display name — never the column name from the table. */
  field: string;
  before: ReactNode;
  after: ReactNode;
}

export interface DiffViewProps {
  /** Names the comparison, e.g. "معاينة التغيير". */
  label: string;
  rows: DiffRow[];
  beforeLabel: string;
  afterLabel: string;
  /** Rendered when nothing would change — a commit control should be
   * disabled against this, not merely look disabled. */
  emptyLabel?: string;
  className?: string;
}

/** Before and after, side by side.
 *
 * The admin intervention queue must show exactly what a change will do
 * before it is committed, and the audit explorer must show exactly what one
 * did. Both are this component: a table of named fields with the old value
 * and the new one, so the difference is read rather than inferred.
 *
 * Each changed row is marked with a glyph as well as a tint, so the change
 * survives a greyscale printout and a colour-vision deficiency. */
export function DiffView({ label, rows, beforeLabel, afterLabel, emptyLabel, className }: DiffViewProps) {
  if (rows.length === 0) {
    return emptyLabel ? <p className={cx("ps-diff__empty", className)}>{emptyLabel}</p> : null;
  }
  return (
    <table className={cx("ps-diff", className)}>
      <caption className="ps-diff__caption">{label}</caption>
      <thead>
        <tr>
          <th scope="col">&nbsp;</th>
          <th scope="col">{beforeLabel}</th>
          <th scope="col">{afterLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.field}>
            <th scope="row" className="ps-diff__field">
              {row.field}
            </th>
            <td className="ps-diff__before">
              <Icon name="minus" size="sm" />
              <span>{row.before}</span>
            </td>
            <td className="ps-diff__after">
              <Icon name="plus" size="sm" />
              <span>{row.after}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
