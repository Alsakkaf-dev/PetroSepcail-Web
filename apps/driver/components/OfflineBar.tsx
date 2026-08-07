"use client";

import { useEffect, useState } from "react";
import { ConnectivityBadge } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";

/**
 * Connectivity in the header, and the service-worker registration that makes
 * being offline survivable.
 *
 * Two jobs in one component because they are one fact: the worker is what
 * keeps the app usable with no signal, and the badge is how the driver knows
 * that is the state they are in. A driver in a basement car park needs to
 * know *before* they tap whether what they are about to do will leave the
 * device.
 *
 * The badge starts as online and corrects itself on mount rather than
 * guessing: the server has no idea, and rendering "offline" for a frame to
 * someone with four bars is its own kind of lie.
 */
export function OfflineBar() {
  const locale = useLocale();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);

    // Registered after paint, never before: a worker that competes with the
    // first render for bandwidth makes the first visit slower to help the
    // second one.
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // An unregistered worker costs offline caching and nothing else. It
        // is not worth an error in front of a driver.
      });
    }

    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return (
    <ConnectivityBadge
      online={online}
      onlineLabel={t(locale, "common.online")}
      offlineLabel={t(locale, "common.offline")}
    />
  );
}
