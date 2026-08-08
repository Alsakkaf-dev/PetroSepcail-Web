"use client";

import { useEffect, useRef } from "react";

// 60-platform-core/02-srs.md's own session table (04-roles-and-permissions-
// matrix.md §1): "idle timeout 30 min (customer/supplier/driver), 15 min for
// admin/super-admin". Specified, never implemented anywhere in the codebase
// before this — an unattended, still-authenticated tab stayed fully usable
// for the whole access-token lifetime (60 min) regardless of role.
//
// Enforced client-side, deliberately: the frozen JWT (04-roles §2) carries no
// `iat`, so the server cannot derive "time since last activity" from the
// token alone without new server-side session state, which is a bigger
// change than a presentation-layer idle guard. This is a real, load-bearing
// gap-closer even so — the alternative was nothing at all.
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "wheel"] as const;

/**
 * Signs the caller out after `timeoutMs` of no pointer/keyboard/touch/scroll
 * activity anywhere on the page. `active` gates the whole thing on being
 * signed in — an idle timer ticking down on a sign-in form is pointless and
 * would fire `onTimeout` into a session that never existed.
 */
export function useIdleTimeout(active: boolean, timeoutMs: number, onTimeout: () => void): void {
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!active || typeof window === "undefined") return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onTimeoutRef.current(), timeoutMs);
    };

    reset();
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset, { passive: true });

    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset);
    };
  }, [active, timeoutMs]);
}
