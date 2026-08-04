import { cx } from "../../utils/cx";
import { Ltr } from "../Data/Ltr";

export interface JsonViewProps {
  /** The before/after payload from an audit row. */
  value: unknown;
  /** Names the block, e.g. "الحالة قبل التغيير". */
  label: string;
  /** Keys whose values are replaced with a mask before rendering. The audit
   * explorer is not a PII-read surface — that is one screen, with its own
   * reason gate and its own banner. */
  redactKeys?: readonly string[];
  /** What a redacted value is replaced with. Localized by the caller. */
  redactedLabel?: string;
  className?: string;
}

function redact(value: unknown, keys: readonly string[], replacement: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => redact(entry, keys, replacement));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        keys.includes(key) ? replacement : redact(entry, keys, replacement)
      ])
    );
  }
  return value;
}

/** A JSON payload, readable.
 *
 * Rendered as text in a `<pre>` rather than an expandable tree, on purpose:
 * an audit record is evidence, and evidence should be selectable, copyable,
 * searchable with the browser's own find, and identical in a printout. A
 * collapsible tree hides exactly the rows an investigation is looking for.
 *
 * Forced LTR, because JSON is a technical string in both languages. */
export function JsonView({ value, label, redactKeys, redactedLabel = "•••", className }: JsonViewProps) {
  const shown = redactKeys?.length ? redact(value, redactKeys, redactedLabel) : value;
  return (
    <figure className={cx("ps-json", className)}>
      <figcaption className="ps-json__label">{label}</figcaption>
      <pre className="ps-json__body">
        <Ltr as="code">{JSON.stringify(shown, null, 2)}</Ltr>
      </pre>
    </figure>
  );
}
