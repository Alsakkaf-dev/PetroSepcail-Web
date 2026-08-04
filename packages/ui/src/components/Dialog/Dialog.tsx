"use client";

import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { useFocusTrap } from "../Overlay/useFocusTrap";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  className?: string;
}

/** PC-08 core set. role="dialog"/aria-modal, Escape + backdrop-click close,
 * focus moves into the dialog on open and returns to the trigger on close.
 *
 * The focus handling now lives in useFocusTrap, shared with Sheet — the two
 * were about to carry the same forty lines, and a focus trap that exists
 * twice is a focus trap that only gets fixed once. */
export function Dialog({ open, onClose, title, children, footer, closeLabel = "Close", className }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(open, panelRef, onClose);

  if (!open) return null;

  return (
    <div
      className="ps-dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={cx("ps-dialog", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="ps-dialog__header">
          <h2 id={titleId} className="ps-dialog__title">
            {title}
          </h2>
          <button type="button" className="ps-dialog__close" onClick={onClose} aria-label={closeLabel}>
            <Icon name="close" size="md" />
          </button>
        </div>
        <div className="ps-dialog__body">{children}</div>
        {footer ? <div className="ps-dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
