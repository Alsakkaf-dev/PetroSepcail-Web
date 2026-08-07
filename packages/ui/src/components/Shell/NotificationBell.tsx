import type { ElementType } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";

export interface NotificationBellProps {
  href: string;
  linkAs?: ElementType;
  /** How many are unread. `null` means "not known yet" — the bell renders
   * with no badge rather than with a zero, because a zero is a claim. */
  unread?: number | null;
  /** "Open notifications" — the link's accessible name. */
  label: string;
  /** "{count} unread", already interpolated. Read out after the label, so the
   * badge's number is never left as a bare numeral floating beside an icon. */
  unreadLabel?: string;
  /** Above this, the badge reads "N+" rather than growing without limit. */
  max?: number;
  className?: string;
}

/**
 * The header bell.
 *
 * A link, not a button — it goes to the notification centre, and the platform's
 * rule is that a control which navigates is a link. The count is announced as
 * words, so a screen reader hears "Open notifications, 3 unread" rather than
 * "link, bell, 3".
 */
export function NotificationBell({
  href,
  linkAs,
  unread,
  label,
  unreadLabel,
  max = 9,
  className
}: NotificationBellProps) {
  const Link: ElementType = linkAs ?? "a";
  const count = unread ?? 0;
  const badge = count > max ? `${max}+` : String(count);
  return (
    <Link href={href} className={cx("ps-bell", count > 0 && "ps-bell--active", className)} aria-label={label}>
      <Icon name="bell" size="md" />
      {count > 0 ? (
        <span className="ps-bell__badge" aria-hidden="true">
          {badge}
        </span>
      ) : null}
      {count > 0 && unreadLabel ? <span className="ps-visually-hidden">{unreadLabel}</span> : null}
    </Link>
  );
}
