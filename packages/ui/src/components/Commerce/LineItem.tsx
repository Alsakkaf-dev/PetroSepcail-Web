import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface LineListProps {
  /** Names the list. A cart, a wishlist and a return form can all appear on
   * one screen, and each one needs its own name. */
  label: string;
  children: ReactNode;
  className?: string;
}

/** The list a `LineItem` belongs in. A real `<ul>`, so a screen reader
 * announces "list, 3 items" before reading the first product. */
export function LineList({ label, children, className }: LineListProps) {
  return (
    <ul className={cx("ps-line-list", className)} aria-label={label}>
      {children}
    </ul>
  );
}

export interface LineItemProps {
  /** The product name, in the reader's own language. */
  title: ReactNode;
  /** A second line under the title: pack size, SKU, the order it came from. */
  meta?: ReactNode;
  /** Notices about this line and no other — "currently unavailable", "the
   * price changed since you added it", "discontinued". Stacked, so a line can
   * carry more than one. */
  notes?: ReactNode;
  /** The interactive part: a `QtyStepper` in a cart, a `Checkbox` on a return
   * form, nothing at all on a read-only line. */
  control?: ReactNode;
  /** A `Money`, already formatted by the server's own figure. */
  price?: ReactNode;
  /** Buttons for this line: remove, move to cart, notify me. */
  action?: ReactNode;
  /** A `ProductThumb`, or nothing where the API gives us no picture to show. */
  media?: ReactNode;
  /** Dims the line without hiding it — an unavailable cart line, a
   * discontinued wishlist entry. The words still have to say why; this is the
   * second signal, never the only one. */
  muted?: boolean;
  className?: string;
}

/**
 * One product inside a cart, a wishlist or a return request.
 *
 * `DataList` is the wrong shape for these: its row is a record made of
 * label/value pairs, and a cart line is a product with a control on it — a
 * quantity stepper that has to sit beside the price it changes, at a size a
 * thumb can hit. So this is its own primitive rather than a `DataList` bent
 * into position.
 *
 * Everything is a slot, and every slot is optional, because the same line
 * appears four ways: with a stepper in the cart, with a checkbox and an
 * attestation on the return form, read-only in the checkout review, and with a
 * "move to cart" button in the wishlist.
 */
export function LineItem({
  title,
  meta,
  notes,
  control,
  price,
  action,
  media,
  muted = false,
  className
}: LineItemProps) {
  return (
    <li className={cx("ps-line", muted && "ps-line--muted", className)}>
      {media ? <div className="ps-line__media">{media}</div> : null}
      <div className="ps-line__body">
        <p className="ps-line__title">{title}</p>
        {meta ? <p className="ps-line__meta">{meta}</p> : null}
        {notes ? <div className="ps-line__notes">{notes}</div> : null}
      </div>
      {control ? <div className="ps-line__control">{control}</div> : null}
      {price ? <div className="ps-line__price">{price}</div> : null}
      {action ? <div className="ps-line__action">{action}</div> : null}
    </li>
  );
}

export type LineNoteTone = "info" | "warn" | "danger" | "muted";

export interface LineNoteProps {
  tone?: LineNoteTone;
  children: ReactNode;
  className?: string;
}

/** A one-line notice on a single product — smaller than a `Banner`, which
 * speaks for a whole screen. The tone is carried by the words; the colour only
 * repeats what they already say. */
export function LineNote({ tone = "info", children, className }: LineNoteProps) {
  return <p className={cx("ps-line-note", `ps-line-note--${tone}`, className)}>{children}</p>;
}
