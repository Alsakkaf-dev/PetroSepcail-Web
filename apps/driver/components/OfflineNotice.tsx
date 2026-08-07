"use client";

import { useEffect, useState } from "react";
import { Banner } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import { canQueue } from "../lib/actionQueue";

/**
 * The line a driver needs to read *before* they capture something, on the
 * three screens where capturing something is the point.
 *
 * Two states, and the second one matters more than it looks. If the browser
 * cannot hold a queue at all — a locked-down kiosk, a private window in an
 * old Safari — then the promise the other message makes is one this device
 * cannot keep, and saying "it will sync" would be a lie told at exactly the
 * moment a proof of delivery is at stake. So it says the opposite: check your
 * signal first.
 *
 * Renders nothing while online and able to queue, which is the normal state.
 */
export function OfflineNotice() {
  const locale = useLocale();
  const [online, setOnline] = useState(true);
  const [queueable, setQueueable] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    setQueueable(canQueue());
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (!queueable) {
    return (
      <Banner tone="warn" icon="warning">
        {t(locale, "driver.queueUnsupported")}
      </Banner>
    );
  }
  if (online) return null;
  return (
    <Banner tone="info" icon="offline">
      {t(locale, "driver.queueOffline")}
    </Banner>
  );
}
