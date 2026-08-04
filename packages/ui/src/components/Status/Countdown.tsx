"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface CountdownProps {
  /** ISO 8601 instant the clock runs to. */
  deadline: string;
  /** Formats the remaining time. Lives with the caller so the wording and
   * the digits come from packages/i18n rather than from this component. */
  format: (parts: CountdownParts) => string;
  /** Shown once the deadline has passed — "انتهت المهلة". */
  expiredLabel: string;
  /** Names the timer, e.g. "الوقت المتبقي لتحويل المبلغ". */
  label: string;
  /** Fires once, when the clock reaches zero while on screen. */
  onExpire?: () => void;
  /** Below this many milliseconds the timer reads as urgent. Defaults to an
   * hour; the 72-hour breach clock wants something much larger. */
  urgentBelowMs?: number;
  className?: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function split(remaining: number): CountdownParts {
  const clamped = Math.max(remaining, 0);
  return {
    days: Math.floor(clamped / DAY),
    hours: Math.floor((clamped % DAY) / HOUR),
    minutes: Math.floor((clamped % HOUR) / MINUTE),
    seconds: Math.floor((clamped % MINUTE) / SECOND)
  };
}

/** A deadline that matters: the 48-hour bank-transfer window, the 72-hour
 * breach-notification clock, the 30-day deletion grace period.
 *
 * Ticks once a second under an hour and once a minute above it — a 30-day
 * countdown re-rendering every second would wake the device for nothing.
 *
 * `suppressHydrationWarning` is deliberate and is the only honest way to
 * server-render a clock: the server's "now" and the browser's "now" are
 * different by construction, so React is told this one text node is expected
 * to differ rather than the whole subtree being made client-only and
 * flashing empty on first paint.
 *
 * The remaining time is announced politely rather than assertively — a
 * screen reader interrupting every second is unusable; the value is there
 * whenever the user asks for it. */
export function Countdown({
  deadline,
  format,
  expiredLabel,
  label,
  onExpire,
  urgentBelowMs = HOUR,
  className
}: CountdownProps) {
  const target = new Date(deadline).getTime();
  const [remaining, setRemaining] = useState(() => target - Date.now());

  useEffect(() => {
    if (Number.isNaN(target)) return;
    const tick = () => setRemaining(target - Date.now());
    tick();
    const left = target - Date.now();
    const interval = setInterval(tick, left > HOUR ? MINUTE : SECOND);
    return () => clearInterval(interval);
  }, [target]);

  // Fires once, on the crossing — not once per tick after it.
  const fired = useRef(false);
  useEffect(() => {
    if (remaining <= 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [remaining, onExpire]);

  if (Number.isNaN(target)) return null;
  const expired = remaining <= 0;
  const urgent = !expired && remaining <= urgentBelowMs;

  return (
    <p
      className={cx("ps-countdown", expired && "ps-countdown--expired", urgent && "ps-countdown--urgent", className)}
      aria-live="polite"
    >
      <Icon name={expired ? "x-circle" : "clock"} size="sm" />
      <span className="ps-visually-hidden">{label}</span>
      <time dateTime={deadline} suppressHydrationWarning>
        {expired ? expiredLabel : format(split(remaining))}
      </time>
    </p>
  );
}
