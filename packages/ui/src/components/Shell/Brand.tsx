import type { ElementType, ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface BrandProps {
  /** Where the mark links to. Omit for a non-interactive lockup (auth screens). */
  href?: string;
  /** `next/link` in an app, a plain anchor anywhere else. */
  linkAs?: ElementType;
  /** Served from each app's own `public/brand/`. */
  logoSrc: string;
  /** Always the company name, never "logo" — the mark *is* the name. */
  logoAlt: string;
  /** "منصة الموزّعين", "تطبيق السائق" — which portal this is. Sits after a
   * hairline so the mark stays the mark. */
  portal?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** The company lockup, identical in all four apps and to the marketing site's
 * own `.brand` (2.6rem tall mark, .7rem gap).
 *
 * The portal label is what stops four apps from looking like four companies:
 * one mark, one hairline, one word saying which door you came in.
 *
 * The `<img>` carries explicit `width`/`height` so the header never reflows
 * when the mark loads — the one CLS source a shell can introduce on every
 * page of the platform at once. */
export function Brand({ href, linkAs, logoSrc, logoAlt, portal, size = "md", className }: BrandProps) {
  const Link: ElementType = href ? (linkAs ?? "a") : "span";
  const linkProps = href ? { href } : {};

  return (
    <Link {...linkProps} className={cx("ps-brand", `ps-brand--${size}`, className)}>
      {/* Intrinsic size of assets/img/logos/main-logo.png; CSS sets the
          rendered height and lets the width follow. */}
      <img className="ps-brand__mark" src={logoSrc} alt={logoAlt} width={204} height={68} />
      {portal ? <span className="ps-brand__portal">{portal}</span> : null}
    </Link>
  );
}
