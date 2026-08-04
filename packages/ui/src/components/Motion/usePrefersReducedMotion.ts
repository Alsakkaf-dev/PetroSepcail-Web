"use client";

import { useEffect, useState } from "react";

/** Whether the viewer has asked for less motion.
 *
 * Starts `true` on purpose. The first render happens on the server, where
 * the preference is unknowable, and the safe assumption is the one that
 * animates nothing — a reveal that starts visible and stays visible is
 * correct for everyone, whereas one that starts invisible and never animates
 * hides content from someone who asked only for calm.
 *
 * CSS carries the same guard in base.css; this hook exists for the cases CSS
 * cannot express, like a counter that must jump straight to its final value
 * rather than run and be hidden. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setReduced(false);
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
