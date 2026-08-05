"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppFooter, AppShell, Brand, Header, SideRail, type IconName } from "@petrospecial/ui";
import { t, type StringKey } from "@petrospecial/i18n";
import { LocaleSwitch, useLocale } from "./client";

export interface ShellNavItem {
  href: string;
  labelKey: StringKey;
  icon?: IconName;
}

export interface ShellRailGroup {
  labelKey?: StringKey;
  items: ShellNavItem[];
}

export interface PortalShellProps {
  /** `brand.portalStore` and friends — which door this is. */
  portalKey: StringKey;
  /** The header nav. Keep it short; anything longer belongs in the rail. */
  nav?: ShellNavItem[];
  /** The console rail, for the two apps with more destinations than a header
   * can hold. */
  rail?: ShellRailGroup[];
  /** Cart count, notification bell, sign-out — rendered beside the language
   * toggle. */
  actions?: ReactNode;
  /** Where the mark links to. */
  homeHref?: string;
  width?: "standard" | "wide" | "flush";
  /** Routes that render without the chrome — the sign-in screen, which is a
   * full-bleed branded surface carrying its own mark. Matched as prefixes.
   *
   * A route group (`app/(app)/layout.tsx`) is the idiomatic Next way to do
   * this, and it would mean moving every page in every app into a folder to
   * express one exception per app. This is the same result with the file tree
   * left alone; `children` stays a server-rendered subtree either way. */
  bareRoutes?: string[];
  /** Routes that keep the header and footer but drop the rail — a portal's
   * signed-out landing page, where a console rail is eleven links to screens
   * that will bounce you straight back to sign-in. */
  noRailRoutes?: string[];
  children: ReactNode;
}

function matches(pathname: string, routes: string[] | undefined): boolean {
  return Boolean(routes?.some((route) => pathname === route || pathname.startsWith(`${route}/`)));
}

/**
 * The chrome every screen in every app sits in.
 *
 * One implementation rather than four, because four separately-written
 * headers is exactly how the platform arrived at a storefront with a nav, a
 * supplier portal with a bare `<h1>` and a driver app with a link. What
 * differs between the apps is data — a portal name, a nav list, whether there
 * is a rail — so that is all a caller passes.
 *
 * `next/link` is injected rather than imported by `packages/ui`, which has no
 * `next` dependency and must keep it that way: its tests run in plain
 * vitest/jsdom with no router.
 */
export function PortalShell({
  portalKey,
  nav,
  rail,
  actions,
  homeHref = "/",
  width = "standard",
  bareRoutes,
  noRailRoutes,
  children
}: PortalShellProps) {
  const locale = useLocale();
  const pathname = usePathname();

  if (matches(pathname, bareRoutes)) return <>{children}</>;
  const railGroups = rail && !matches(pathname, noRailRoutes) ? rail : undefined;

  // A section stays current for its own detail pages: /orders/[id] is still
  // "Orders". The root is matched exactly, or it would be current everywhere.
  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  const brand = (
    <Brand
      href={homeHref}
      linkAs={Link}
      logoSrc="/brand/petrospecial.png"
      logoAlt={t(locale, "brand.name")}
      portal={t(locale, portalKey)}
    />
  );

  return (
    <AppShell
      width={width}
      header={
        <Header
          logo={brand}
          navItems={(nav ?? []).map((item) => ({
            label: t(locale, item.labelKey),
            href: item.href,
            current: isCurrent(item.href)
          }))}
          languageSlot={<LocaleSwitch />}
          actionsSlot={actions}
          menuLabel={t(locale, "common.menu")}
          closeMenuLabel={t(locale, "common.closeMenu")}
        />
      }
      sidebar={
        railGroups ? (
          <SideRail
            label={t(locale, "shell.sectionNav")}
            linkAs={Link}
            groups={railGroups.map((group) => ({
              ...(group.labelKey ? { label: t(locale, group.labelKey) } : {}),
              items: group.items.map((item) => ({
                href: item.href,
                label: t(locale, item.labelKey),
                ...(item.icon ? { icon: item.icon } : {}),
                current: isCurrent(item.href)
              }))
            }))}
          />
        ) : undefined
      }
      footer={
        <AppFooter
          brand={
            <Brand
              href={homeHref}
              linkAs={Link}
              size="sm"
              logoSrc="/brand/petrospecial.png"
              logoAlt={t(locale, "brand.name")}
            />
          }
          tagline={t(locale, "brand.tagline")}
          // A four-digit year is a self-contained numeral run with no adjacent
          // Latin text, so it needs no bidi isolation of its own — unlike an
          // IBAN, a phone number or a SKU, which all go through <Ltr>.
          legal={t(locale, "shell.legal", { year: new Date().getFullYear() })}
        />
      }
    >
      {children}
    </AppShell>
  );
}
