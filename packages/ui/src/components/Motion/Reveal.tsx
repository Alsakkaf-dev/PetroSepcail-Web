"use client";

import { Children, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "../../utils/cx";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export type RevealVariant = "up" | "left" | "right" | "scale";

export interface RevealProps {
  children: ReactNode;
  variant?: RevealVariant;
  /** Seconds of delay. A number rather than a style, because app code may
   * not write `style={{"--delay": …}}` — that is exactly the case §5.3's
   * primitives exist for. */
  delay?: number;
  className?: string;
}

/** Scroll reveal: opacity 0→1 with a 28px rise, once, when the element comes
 * into view. The brand's one entrance animation.
 *
 * `left` and `right` are *visual* directions and are not mirrored — a card
 * that enters from the left enters from the left in both languages, because
 * the motion is choreography rather than reading order.
 *
 * Under `prefers-reduced-motion` nothing observes and nothing animates: the
 * content is simply visible from the first paint. One-shot, so a long page
 * does not re-animate as it is scrolled back over. */
export function Reveal({ children, variant = "up", delay = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (reduced || shown) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver !== "function") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced, shown]);

  const style: CSSProperties | undefined = delay > 0 && !reduced ? { transitionDelay: `${delay}s` } : undefined;

  return (
    <div
      ref={ref}
      className={cx("ps-reveal", `ps-reveal--${variant}`, (shown || reduced) && "ps-reveal--in", className)}
      style={style}
    >
      {children}
    </div>
  );
}

export interface StaggerProps {
  children: ReactNode;
  /** Seconds between each child's entrance. The marketing site uses 0.12. */
  step?: number;
  variant?: RevealVariant;
  className?: string;
}

/** A group whose children enter one after another.
 *
 * Each child is wrapped in its own Reveal with an increasing delay, rather
 * than a script walking the DOM and writing custom properties after mount —
 * which is how the marketing site does it and why its cards can flash
 * un-styled on a slow connection. */
export function Stagger({ children, step = 0.12, variant = "up", className }: StaggerProps) {
  return (
    <div className={cx("ps-stagger", className)}>
      {Children.toArray(children).map((child, index) => (
        <Reveal key={index} variant={variant} delay={index * step}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
