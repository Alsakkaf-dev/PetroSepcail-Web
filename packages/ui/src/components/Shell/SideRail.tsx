import type { ElementType } from "react";
import { cx } from "../../utils/cx";
import { Icon, type IconName } from "../../icons";

export interface SideRailItem {
  href: string;
  label: string;
  icon?: IconName;
  current?: boolean;
  /** A count worth seeing before you click: an unverified-proofs queue, an
   * open-dispute count. Already formatted by the caller. */
  badge?: string;
}

export interface SideRailGroup {
  /** Omit on the first group — a single unlabelled list reads better than a
   * heading over three items. */
  label?: string;
  items: SideRailItem[];
}

export interface SideRailProps {
  /** Names the landmark. Required: an app with a header nav *and* a rail has
   * two navigation regions, and "navigation" twice helps nobody. */
  label: string;
  groups: SideRailGroup[];
  linkAs?: ElementType;
  className?: string;
}

/** The console navigation for admin and supplier — the two apps with more
 * destinations than a header can hold.
 *
 * Below 60em it becomes a horizontally scrolling strip of the same items
 * rather than a drawer: on a phone the rail is the fastest way between two
 * screens, and hiding it behind a button costs a tap on every navigation.
 * Same markup either way — the layout change is entirely CSS, so the reading
 * order and the tab order never diverge from what is drawn. */
export function SideRail({ label, groups, linkAs, className }: SideRailProps) {
  const Link: ElementType = linkAs ?? "a";

  return (
    <nav className={cx("ps-rail-nav", className)} aria-label={label}>
      {groups.map((group, index) => (
        <div className="ps-rail-nav__group" key={group.label ?? index}>
          {group.label ? <p className="ps-rail-nav__group-label">{group.label}</p> : null}
          <ul className="ps-rail-nav__list">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cx("ps-rail-nav__link", item.current && "ps-rail-nav__link--current")}
                  aria-current={item.current ? "page" : undefined}
                >
                  {item.icon ? (
                    <span className="ps-rail-nav__icon">
                      <Icon name={item.icon} size="md" />
                    </span>
                  ) : null}
                  <span className="ps-rail-nav__label">{item.label}</span>
                  {item.badge ? <span className="ps-rail-nav__badge">{item.badge}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
