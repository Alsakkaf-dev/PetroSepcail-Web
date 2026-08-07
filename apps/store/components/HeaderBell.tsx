"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NotificationBell } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../lib/authClient";

/** How often the unread count is re-checked while the tab is open.
 *
 * PC-06's live badge is meant to come off the realtime channel; that channel
 * is Pusher, which DEFERRED-DECISIONS §3 retires in favour of Supabase
 * Realtime, and neither is wired. Polling once a minute is the honest
 * stand-in: it costs one small request, it is visibly live enough for a
 * header badge, and it becomes a subscription with no change to this
 * component's shape. */
const POLL_MS = 60_000;

interface NotificationsResponse {
  items: unknown[];
}

/**
 * The header bell and its unread badge.
 *
 * Renders nothing at all for a signed-out visitor: an empty bell on a page
 * nobody can act on is chrome pretending to be a feature. The count stays
 * `null` until the first response, so the badge never flashes a zero it does
 * not know to be true.
 */
export function HeaderBell() {
  const locale = useLocale();
  const [unread, setUnread] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    setSignedIn(true);
    let cancelled = false;
    const read = () => {
      authedFetch<NotificationsResponse>("/api/v1/notifications?unread=true&limit=50")
        .then((page) => {
          if (!cancelled) setUnread(page.items.length);
        })
        .catch(() => {
          // A failed count is not worth a message in the header. The
          // notification centre itself reports its own errors properly.
          if (!cancelled) setUnread(null);
        });
    };
    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!signedIn) return null;

  return (
    <NotificationBell
      href="/notifications"
      linkAs={Link}
      unread={unread}
      label={t(locale, "notif.open")}
      unreadLabel={unread ? t(locale, "notif.unreadCount", { count: count(unread) }) : undefined}
    />
  );
}
