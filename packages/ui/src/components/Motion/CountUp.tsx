"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "../../utils/cx";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export interface CountUpProps {
  /** The final figure. Server-supplied, like every other number on screen. */
  value: number;
  /** Formats each frame — pass the platform's own formatter so the digits,
   * grouping and currency match everything around it. */
  format: (value: number) => string;
  /** Milliseconds. The brand's count-up runs for about 1.6 seconds. */
  duration?: number;
  className?: string;
}

/** Ease-out-cubic, the site's own curve. */
function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

/** A headline figure that counts up once, when it first appears.
 *
 * Decoration on a number, so it dies completely under reduced motion — the
 * final value is written immediately, not animated fast. It also never
 * animates on the server or before the element is in view.
 *
 * The rendered text is wrapped in a live region set to `off`: a screen
 * reader must hear the final figure, not sixty intermediate ones. */
export function CountUp({ value, format, duration = 1600, className }: CountUpProps) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);
  const started = useRef(false);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    const node = ref.current;
    if (!node || typeof IntersectionObserver !== "function" || typeof requestAnimationFrame !== "function") {
      setDisplay(value);
      return;
    }

    let frame = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - start) / duration, 1);
        setDisplay(value * easeOutCubic(progress));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            run();
            observer.disconnect();
          }
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [value, duration, reduced]);

  return (
    <span ref={ref} className={cx("ps-countup", className)} aria-live="off">
      {format(display)}
    </span>
  );
}
