"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal focus management, shared by Dialog and Sheet.
 *
 * Moves focus into the panel on open, keeps Tab inside it while it is open,
 * closes on Escape, and returns focus to whatever opened it on close. That
 * last part is the one most often missed: without it a keyboard user who
 * closes a filter sheet is dropped back at the top of the document.
 *
 * Implemented directly rather than with the native `<dialog>` element, whose
 * `showModal()` is not reliably supported in jsdom or in older mobile
 * browsers — the two places this most needs to work. */
export function useFocusTrap(open: boolean, panelRef: RefObject<HTMLElement>, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      (previouslyFocused as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose, panelRef]);
}
