import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon, type IconName } from "../../icons";

export type BannerTone = "info" | "success" | "warn" | "danger";

export interface BannerProps {
  tone?: BannerTone;
  /** Short headline. Optional — a one-line banner reads better without one. */
  title?: ReactNode;
  children: ReactNode;
  /** A button or link that resolves the situation the banner describes. */
  action?: ReactNode;
  /** Override the tone's glyph where a more specific one says more — the
   * offline banner is the obvious case. */
  icon?: IconName;
  className?: string;
}

const TONE_ICON: Record<BannerTone, IconName> = {
  info: "info",
  success: "check-circle",
  warn: "warning",
  danger: "alert"
};

/** A persistent message about the surface it sits on: a credit block, an
 * out-of-radius warning, "this access will be recorded in the audit log", the
 * 48-hour bank-transfer window.
 *
 * `danger` and `warn` announce themselves (`role="alert"`); `info` and
 * `success` don't interrupt. The tone is carried by an icon and by the words,
 * never by the tint alone — and the text is `--ink`, because `--flame` and
 * `--gold` fail AA as body copy and are accents here, not foregrounds. */
export function Banner({ tone = "info", title, children, action, icon, className }: BannerProps) {
  const assertive = tone === "danger" || tone === "warn";
  return (
    <div
      className={cx("ps-banner", `ps-banner--${tone}`, className)}
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
    >
      <span className="ps-banner__icon">
        <Icon name={icon ?? TONE_ICON[tone]} size="lg" />
      </span>
      <div className="ps-banner__body">
        {title ? <p className="ps-banner__title">{title}</p> : null}
        <div className="ps-banner__text">{children}</div>
      </div>
      {action ? <div className="ps-banner__action">{action}</div> : null}
    </div>
  );
}
