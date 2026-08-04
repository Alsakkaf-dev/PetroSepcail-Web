"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons/Icon";

export interface CopyButtonProps {
  /** The exact value to put on the clipboard — the full id, the unmasked
   * IBAN, the whole transfer reference. What is *shown* may be shortened;
   * what is copied never is. */
  value: string;
  /** Accessible name, localized, e.g. "نسخ رقم الطلب". */
  label: string;
  /** Announced and shown after a successful copy, e.g. "تم النسخ". */
  copiedLabel: string;
  /** Shown alongside the icon. Off by default — most call sites sit next to
   * the value they copy, where a bare icon button is enough. */
  showLabel?: boolean;
  className?: string;
}

/** Copy-to-clipboard, used everywhere an opaque value has to be reportable
 * to support: order ids, bank-transfer references, IBANs, ZATCA UUIDs.
 *
 * The confirmation is a live region rather than a tooltip, because a
 * keyboard or screen-reader user gets no hover and would otherwise have no
 * idea whether the copy worked. It reverts after two seconds, and the timer
 * is cleared on unmount so a fast navigation can't set state on a dead
 * component. */
export function CopyButton({ value, label, copiedLabel, showLabel = false, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // A denied clipboard permission is not something to shout about — the
      // value is still on screen and selectable. Staying silent beats
      // rendering a technical failure the user can do nothing with.
      setCopied(false);
    }
  }, [value]);

  return (
    <button
      type="button"
      className={cx("ps-copy-button", copied && "ps-copy-button--copied", className)}
      onClick={onCopy}
      aria-label={showLabel ? undefined : label}
    >
      <Icon name={copied ? "check" : "copy"} size="sm" />
      {showLabel ? <span className="ps-copy-button__label">{copied ? copiedLabel : label}</span> : null}
      <span className="ps-visually-hidden" role="status" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
    </button>
  );
}
