"use client";

import { useCallback, useId, useRef } from "react";
import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface TabItem {
  id: string;
  label: ReactNode;
  /** A count beside the label — pending proofs, open disputes. */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  /** Names the tab list. Two tab sets on one screen each need their own. */
  label: string;
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  children: ReactNode;
  className?: string;
}

/** Tabs with the keyboard behaviour the ARIA pattern requires: one tab stop
 * for the whole set, arrow keys to move between them, Home/End to jump.
 *
 * Used where two views must stay visually distinct and never blend — the
 * verification queue's bank-transfer proofs and custody remittances, the
 * user-management roles. Verifying a remittance must never look like it
 * touched a debt figure, and separate tabs are part of how that stays true.
 *
 * Arrow keys move to the next *enabled* tab, skipping disabled ones rather
 * than stopping dead on them. */
export function Tabs({ label, items, value, onChange, children, className }: TabsProps) {
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const move = useCallback(
    (from: number, step: number) => {
      const count = items.length;
      for (let offset = 1; offset <= count; offset += 1) {
        const index = (((from + step * offset) % count) + count) % count;
        const candidate = items[index];
        if (candidate && !candidate.disabled) {
          onChange(candidate.id);
          listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
          return;
        }
      }
    },
    [items, onChange]
  );

  return (
    <div className={cx("ps-tabs", className)}>
      <div className="ps-tabs__list" role="tablist" aria-label={label} ref={listRef}>
        {items.map((item, index) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              // One tab stop for the set: Tab enters and leaves, arrows move
              // within. A tab stop per tab is the classic way to make a
              // ten-tab screen unusable from the keyboard.
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={cx("ps-tabs__tab", selected && "ps-tabs__tab--selected")}
              onClick={() => onChange(item.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  // Arrow keys follow the *visual* order, which mirrors with
                  // the document — so ArrowRight moves to the previous tab in
                  // Arabic, exactly as a native control would.
                  const rtl = document.documentElement.dir === "rtl";
                  const forward = event.key === (rtl ? "ArrowLeft" : "ArrowRight");
                  move(index, forward ? 1 : -1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  move(-1, 1);
                } else if (event.key === "End") {
                  event.preventDefault();
                  move(items.length, -1);
                }
              }}
            >
              <span>{item.label}</span>
              {item.badge !== undefined ? <span className="ps-tabs__badge">{item.badge}</span> : null}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel-${value}`}
        aria-labelledby={`${base}-tab-${value}`}
        tabIndex={0}
        className="ps-tabs__panel"
      >
        {children}
      </div>
    </div>
  );
}
