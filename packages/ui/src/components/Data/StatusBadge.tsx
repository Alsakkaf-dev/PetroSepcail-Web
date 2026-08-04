import { statusLabel, statusTone, type Locale, type StatusKind } from "@petrospecial/i18n";
import { Badge } from "../Badge/Badge";
import { Icon, type IconName } from "../../icons";
import type { StatusTone } from "@petrospecial/i18n";

export interface StatusBadgeProps {
  /** Which D-04 enum this value belongs to. */
  kind: StatusKind;
  /** The raw enum value from the API — `en_route`, `partially_paid`. */
  value: string;
  locale: Locale;
  className?: string;
}

/** A glyph per tone, so status is never carried by colour alone. Someone
 * with a colour-vision deficiency, or looking at a printed statement, still
 * gets the distinction. */
const TONE_ICON: Record<StatusTone, IconName> = {
  neutral: "minus",
  info: "info",
  progress: "clock",
  success: "check-circle",
  warn: "warning",
  danger: "x-circle"
};

/** The only way a status reaches a screen.
 *
 * A bare enum value on screen is a defect (design language §3.5): the label
 * comes from D-04 via `packages/i18n`, in both languages, and the tone is a
 * property of the status rather than a decision each screen re-makes. That is
 * what stopped `--f-raval` — the Raval *product family* colour — from being
 * used as "error red" in twenty places. */
export function StatusBadge({ kind, value, locale, className }: StatusBadgeProps) {
  const tone = statusTone(kind, value);
  return (
    <Badge variant={tone} className={className}>
      <Icon name={TONE_ICON[tone]} size="sm" />
      {statusLabel(kind, locale, value)}
    </Badge>
  );
}
