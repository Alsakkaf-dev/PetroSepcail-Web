"use client";

import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { useFocusTrap } from "./useFocusTrap";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Sticky at the foot of the sheet — "عرض ٢٤ نتيجة", "مسح الفلاتر". A
   * filter sheet whose apply button scrolls away is a filter sheet nobody
   * finishes. */
  footer?: ReactNode;
  /** `block-end` slides up from the bottom (the phone default, reachable by
   * thumb); `inline-start`/`inline-end` slide in from a reading edge and
   * mirror with the document. */
  placement?: "block-end" | "inline-start" | "inline-end";
  closeLabel?: string;
  className?: string;
}

/** A panel that slides in over the page: the catalog filter rail on a phone,
 * a quick-view, a set of row actions.
 *
 * Shares Dialog's focus handling, so Tab stays inside it, Escape closes it,
 * and focus returns to whatever opened it — the part that decides whether a
 * keyboard user can use a filter sheet twice.
 *
 * Distinct from Dialog by intent, not by mechanics: a Dialog interrupts to
 * ask something, a Sheet holds controls the page owns. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  placement = "block-end",
  closeLabel = "Close",
  className
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(open, panelRef, onClose);

  if (!open) return null;

  return (
    <div
      className="ps-sheet-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={cx("ps-sheet", `ps-sheet--${placement}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="ps-sheet__header">
          <span className="ps-sheet__grip" aria-hidden="true" />
          <h2 id={titleId} className="ps-sheet__title">
            {title}
          </h2>
          <button type="button" className="ps-sheet__close" onClick={onClose} aria-label={closeLabel}>
            <Icon name="close" size="md" />
          </button>
        </div>
        <div className="ps-sheet__body">{children}</div>
        {footer ? <div className="ps-sheet__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
