import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export interface ConnectivityBadgeProps {
  /** The app owns the listener — this component only renders the fact. */
  online: boolean;
  onlineLabel: string;
  offlineLabel: string;
  className?: string;
}

/** Connectivity, on every actionable driver screen.
 *
 * A driver in a basement car park needs to know, before they tap, whether
 * what they are about to do will leave the device. The state is announced
 * politely when it changes, and it is never carried by colour alone: the
 * glyph and the word both change. */
export function ConnectivityBadge({ online, onlineLabel, offlineLabel, className }: ConnectivityBadgeProps) {
  return (
    <p
      className={cx("ps-connectivity", online ? "ps-connectivity--online" : "ps-connectivity--offline", className)}
      role="status"
      aria-live="polite"
    >
      <Icon name={online ? "online" : "offline"} size="sm" />
      <span>{online ? onlineLabel : offlineLabel}</span>
    </p>
  );
}

export interface SyncQueueBadgeProps {
  /** How many actions are waiting to reach the server. */
  pending: number;
  /** Localized "سيتم المزامنة" plus the count — the caller formats it, so
   * the number goes through the platform's own formatter. */
  label: string;
  /** Shown when nothing is queued; omit to render nothing at all. */
  syncedLabel?: string;
  className?: string;
}

/** The visible "this will sync" promise behind the driver's offline queue.
 *
 * A POD, a ping or a transition is never lost, and the person who captured
 * it has to be able to see that. A queue that drains silently and invisibly
 * is indistinguishable from one that dropped everything. */
export function SyncQueueBadge({ pending, label, syncedLabel, className }: SyncQueueBadgeProps) {
  if (pending <= 0 && !syncedLabel) return null;
  const queued = pending > 0;
  return (
    <p
      className={cx("ps-syncqueue", queued ? "ps-syncqueue--pending" : "ps-syncqueue--synced", className)}
      role="status"
      aria-live="polite"
    >
      <Icon name={queued ? "retry" : "check-circle"} size="sm" spin={queued} />
      <span>{queued ? label : syncedLabel}</span>
    </p>
  );
}
