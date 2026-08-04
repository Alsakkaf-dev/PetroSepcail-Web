"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface HeaderNavItem {
  label: string;
  href: string;
  current?: boolean;
}

export interface HeaderProps {
  logo: ReactNode;
  navItems: HeaderNavItem[];
  /** Typically a <LanguageToggle />. */
  languageSlot?: ReactNode;
  /** Cart/account/notification icons, etc. */
  actionsSlot?: ReactNode;
  menuLabel?: string;
  closeMenuLabel?: string;
}

/** PC-08 core set — site header. Collapses nav to a toggled menu below
 * `--header-h` on narrow viewports (PC-08 §5: "Header collapses to a menu as
 * on the current site"). */
export function Header({ logo, navItems, languageSlot, actionsSlot, menuLabel = "Menu", closeMenuLabel = "Close menu" }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const navId = useId();

  return (
    <header className="ps-header">
      <div className="ps-header__bar">
        <div className="ps-header__logo">{logo}</div>
        <nav id={navId} className={cx("ps-header__nav", open && "ps-header__nav--open")} aria-label={menuLabel}>
          <ul className="ps-header__nav-list">
            {navItems.map((item) => (
              <li key={item.href}>
                <a href={item.href} aria-current={item.current ? "page" : undefined} className="ps-header__nav-link">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ps-header__actions">
          {languageSlot}
          {actionsSlot}
          <button
            type="button"
            className="ps-header__menu-toggle"
            aria-expanded={open}
            aria-controls={navId}
            aria-label={open ? closeMenuLabel : menuLabel}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="ps-header__menu-icon" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
