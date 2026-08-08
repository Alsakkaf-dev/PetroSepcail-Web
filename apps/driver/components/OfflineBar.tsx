"use client";

import { useEffect, useState } from "react";
import { Cluster, ConnectivityBadge, SyncQueueBadge } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, t } from "@petrospecial/i18n";
import { onSessionExpired } from "../lib/authClient";
import { onQueueChange, watchConnection } from "../lib/syncClient";

/**
 * Connectivity, the pending-work count, and the service-worker registration
 * that makes being offline survivable — one component, because they are one
 * fact.
 *
 * A driver in a basement car park needs to know two things before they tap:
 * whether what they are about to do will leave the device, and whether
 * anything they already did is still waiting. A queue that drains invisibly
 * is indistinguishable from one that dropped everything, which is why the
 * count is in the header and not in a console.
 *
 * The badge starts as online and corrects itself on mount rather than
 * guessing: the server has no idea, and rendering "offline" for a frame to
 * someone with four bars is its own kind of lie.
 */
export function OfflineBar() {
  const locale = useLocale();
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);

    // Drains the queue now and again on every reconnect.
    const stopWatching = watchConnection();
    const unsubscribe = onQueueChange(setPending);

    // Fires synchronously inside authedFetch's own dispatchEvent call — the
    // navigation is pushed to a macrotask so a caller that queues a failed
    // write on the same 401 (sendOrQueue's catch, an async IndexedDB put)
    // gets to finish first. Redirecting immediately, mid-call-stack, risked
    // leaving that write half-done when the page unloaded out from under it.
    const stopExpiryWatch = onSessionExpired(() => {
      setTimeout(() => {
        window.location.href = "/login";
      }, 0);
    });

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
      stopWatching();
      unsubscribe();
      stopExpiryWatch();
    };
  }, []);

  return (
    <Cluster gap="sm">
      <ConnectivityBadge
        online={online}
        onlineLabel={t(locale, "common.online")}
        offlineLabel={t(locale, "common.offline")}
      />
      {/* No `syncedLabel`: an empty queue is the normal state and does not
          need a permanent line in the header saying so. */}
      <SyncQueueBadge pending={pending} label={t(locale, "driver.queueCount", { count: count(pending) })} />
    </Cluster>
  );
}
