import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon, type IconName } from "../../icons";

/** The three money surfaces D-14 rule (f) keeps apart:
 *
 *  - `debt`          — B2B credit. What the supplier owes.
 *  - `custody-funds` — cash collected on someone else's behalf and not yet
 *                      remitted. Held, not owed.
 *  - `goods-custody` — parcels held for pickup. Neither cash nor debt.
 *
 * They are never summed, and no screen shows a total-balance figure across
 * them. A supplier holding SAR 4,000 of customers' cash does not owe SAR
 * 4,000, and a single "balance" number would say they did. */
export type FinanceKind = "debt" | "custody-funds" | "goods-custody";

interface FinancePanelBase {
  /** The panel's own heading. Each surface owns one; they never share. */
  title: string;
  /** The second half of the bilingual heading, e.g. "ما عليك". */
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Point the surrounding region's aria-labelledby at this. */
  titleId?: string;
  className?: string;
}

/** A custody panel must carry its separation note — it is a required prop,
 * not a convention, so "not part of what you owe" cannot be dropped in a
 * refactor. This is the one rule in the component library enforced by the
 * type system rather than by review. */
export type FinancePanelProps =
  | ({ kind: "debt" } & FinancePanelBase)
  | ({ kind: "custody-funds" | "goods-custody"; separationNote: ReactNode } & FinancePanelBase);

const KIND_ICON: Record<FinanceKind, IconName> = {
  debt: "wallet",
  "custody-funds": "banknote",
  "goods-custody": "package"
};

/** One of the three finance surfaces, with its own heading, its own accent
 * and its own box.
 *
 * The accent differs per kind, but colour is never what carries the
 * separation — the heading does, and on the two custody surfaces so does a
 * permanent line saying what this money is not. Stacked on a phone the
 * panels keep their own borders and headings, which is what stops them
 * reading as one running total at 360px. */
export function FinancePanel(props: FinancePanelProps) {
  const { kind, title, subtitle, children, actions, titleId, className } = props;
  const separationNote = kind === "debt" ? undefined : props.separationNote;
  return (
    <section
      className={cx("ps-finance", `ps-finance--${kind}`, className)}
      aria-labelledby={titleId}
      data-finance-kind={kind}
    >
      <header className="ps-finance__header">
        <span className="ps-finance__icon" aria-hidden="true">
          <Icon name={KIND_ICON[kind]} size="lg" />
        </span>
        <div className="ps-finance__heading">
          <h3 id={titleId} className="ps-finance__title">
            {title}
          </h3>
          {subtitle ? <p className="ps-finance__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="ps-finance__actions">{actions}</div> : null}
      </header>
      {separationNote ? (
        <p className="ps-finance__separation">
          <Icon name="info" size="sm" />
          <span>{separationNote}</span>
        </p>
      ) : null}
      <div className="ps-finance__body">{children}</div>
    </section>
  );
}
