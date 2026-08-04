import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon, type IconName } from "../../icons";

export interface TimelineEntry {
  id: string;
  /** Usually a D-04 status label — never a bare enum value. */
  title: ReactNode;
  /** A <DateTime>, so the instant is machine-readable and in Riyadh. */
  timestamp?: ReactNode;
  detail?: ReactNode;
  icon?: IconName;
  tone?: "done" | "current" | "pending" | "failed";
}

export interface TimelineProps {
  /** Names the list, e.g. "مسار الطلب". */
  label: string;
  entries: TimelineEntry[];
  className?: string;
}

const TONE_ICON: Record<NonNullable<TimelineEntry["tone"]>, IconName> = {
  done: "check",
  current: "clock",
  pending: "minus",
  failed: "x-circle"
};

/** What has happened to this order, task or invoice, in order.
 *
 * An ordered list, because the sequence is the content. The rail and the
 * markers are `aria-hidden` decoration; each entry's meaning is carried by
 * its title, its timestamp and its tone icon, so nothing depends on seeing
 * the line that connects them. */
export function Timeline({ label, entries, className }: TimelineProps) {
  return (
    <ol className={cx("ps-timeline", className)} aria-label={label}>
      {entries.map((entry) => {
        const tone = entry.tone ?? "done";
        return (
          <li key={entry.id} className={cx("ps-timeline__entry", `ps-timeline__entry--${tone}`)}>
            <span className="ps-timeline__marker" aria-hidden="true">
              <Icon name={entry.icon ?? TONE_ICON[tone]} size="sm" />
            </span>
            <div className="ps-timeline__body">
              <p className="ps-timeline__title">{entry.title}</p>
              {entry.timestamp ? <p className="ps-timeline__time">{entry.timestamp}</p> : null}
              {entry.detail ? <div className="ps-timeline__detail">{entry.detail}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export interface StepperStep {
  id: string;
  label: ReactNode;
  /** Shown under the label on the current step — what to do here. */
  hint?: ReactNode;
}

export interface StepperProps {
  /** Names the progress indicator, e.g. "خطوات الدفع". */
  label: string;
  steps: StepperStep[];
  /** Zero-based index of the step being worked on. */
  current: number;
  /** Localized "الخطوة ٢ من ٤" — assistive tech gets position as words, not
   * as a picture of four circles. */
  status?: string;
  /** Localized names for the state of each marker, announced per step. */
  stateLabels?: { done: string; current: string; upcoming: string };
  className?: string;
}

/** Where you are in a multi-step flow: checkout's four steps, a driver task's
 * transitions, a return request.
 *
 * The steps are an ordered list with the current one marked `aria-current`,
 * and each marker's state is spelled out for assistive tech rather than
 * being carried by a filled circle. */
export function Stepper({ label, steps, current, status, stateLabels, className }: StepperProps) {
  return (
    <div className={cx("ps-stepper", className)} aria-label={label} role="group">
      {status ? (
        <p className="ps-stepper__status" aria-live="polite">
          {status}
        </p>
      ) : null}
      <ol className="ps-stepper__list">
        {steps.map((step, index) => {
          const state = index < current ? "done" : index === current ? "current" : "upcoming";
          return (
            <li
              key={step.id}
              className={cx("ps-stepper__step", `ps-stepper__step--${state}`)}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="ps-stepper__marker" aria-hidden="true">
                {state === "done" ? <Icon name="check" size="sm" /> : <span className="ps-ltr">{index + 1}</span>}
              </span>
              <span className="ps-stepper__text">
                <span className="ps-stepper__label">
                  {step.label}
                  {stateLabels ? <span className="ps-visually-hidden">{stateLabels[state]}</span> : null}
                </span>
                {step.hint && state === "current" ? <span className="ps-stepper__hint">{step.hint}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
