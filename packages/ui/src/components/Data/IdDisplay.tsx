import { shortId } from "@petrospecial/i18n";
import { cx } from "../../utils/cx";
import { Ltr } from "./Ltr";
import { CopyButton } from "./CopyButton";

export interface IdDisplayProps {
  /** The opaque value — a UUID, a delivery id, a payment reference. */
  id: string;
  /** The human-readable thing this id points at, when the API gives one: a
   * customer name, a product title, an invoice number. Given a name, the id
   * becomes a secondary detail instead of the label. */
  name?: string;
  /** Shown before the shortened id, e.g. "رقم الطلب". */
  label?: string;
  /** Localized copy-control strings. Omit to render no copy control — but
   * then the value has to be reportable some other way. */
  copy?: { label: string; copiedLabel: string };
  /** Characters of the id to show before the ellipsis. */
  visible?: number;
  className?: string;
}

/** Never render a raw UUID as a user-facing label (design language §3.5).
 *
 * A UUID printed as an order number is not an identifier a person can read
 * back over the phone, and the storefront's order detail screen was doing
 * exactly that. This component resolves to the name where the API provides
 * one, and otherwise shows a clearly-truncated id with a copy control — so
 * the value stays reportable to support without pretending to be a
 * human-readable reference.
 *
 * The `title` attribute carries the full value for a mouse user, and the copy
 * button carries it for everyone else. */
export function IdDisplay({ id, name, label, copy, visible = 8, className }: IdDisplayProps) {
  const truncated = shortId(id, visible);
  return (
    <span className={cx("ps-id", className)}>
      {label ? <span className="ps-id__label">{label}</span> : null}
      {name ? <span className="ps-id__name">{name}</span> : null}
      <Ltr as="code" title={id} className={cx("ps-id__value", name && "ps-id__value--secondary")}>
        {truncated}
      </Ltr>
      {copy ? <CopyButton value={id} label={copy.label} copiedLabel={copy.copiedLabel} /> : null}
    </span>
  );
}
