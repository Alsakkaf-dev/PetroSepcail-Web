import type { ReactNode } from "react";
import { cx } from "../../utils/cx";

export interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

/** Small gold label above a heading — the first element of the brand's
 * section triplet (eyebrow → heading → gold-diamond divider). Its leading
 * rule is a `::before`, so it grows from the start edge in both directions
 * with no markup change. */
export function Eyebrow({ children, className }: EyebrowProps) {
  return <p className={cx("ps-eyebrow", className)}>{children}</p>;
}

export interface DividerProps {
  /** `diamond` is the signature separator; `line` is a plain hairline rule
   * for splitting rows inside a panel. */
  variant?: "diamond" | "line";
  align?: "start" | "center";
  className?: string;
}

/** The gold-diamond divider. Purely decorative, so it is hidden from
 * assistive tech: a screen reader user gets the heading, which is the actual
 * structure. */
export function Divider({ variant = "diamond", align = "start", className }: DividerProps) {
  return (
    <div
      className={cx("ps-divider", `ps-divider--${variant}`, `ps-divider--${align}`, className)}
      aria-hidden="true"
    >
      {variant === "diamond" ? (
        <svg viewBox="0 0 10 10" fill="currentColor" focusable="false">
          <path d="M5 0l5 5-5 5-5-5z" />
        </svg>
      ) : null}
    </div>
  );
}

export interface SectionHeadProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  lead?: ReactNode;
  /** Heading rank. Pick it from the document outline, never from the size
   * you want — the size comes from the token ramp either way. */
  level?: 1 | 2 | 3;
  /** Set this and point the surrounding Section's `aria-labelledby` at it. */
  titleId?: string;
  align?: "start" | "center";
  divider?: boolean;
  /** Trailing controls — a filter, a "view all" link, an export button. Sits
   * at the end of the heading row and wraps under it on a phone. */
  actions?: ReactNode;
  className?: string;
}

/** Eyebrow + heading + divider + lead, in that order: the section triplet
 * from the marketing site, so a heading in the admin console and one on the
 * brochure are recognisably the same company. */
export function SectionHead({
  title,
  eyebrow,
  lead,
  level = 2,
  titleId,
  align = "start",
  divider = true,
  actions,
  className
}: SectionHeadProps) {
  const Heading = level === 1 ? "h1" : level === 3 ? "h3" : "h2";
  return (
    <div className={cx("ps-section-head", `ps-section-head--${align}`, className)}>
      <div className="ps-section-head__main">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Heading id={titleId} className="ps-section-head__title">
          {title}
        </Heading>
        {divider ? <Divider align={align} /> : null}
        {lead ? <p className="ps-section-head__lead">{lead}</p> : null}
      </div>
      {actions ? <div className="ps-section-head__actions">{actions}</div> : null}
    </div>
  );
}
