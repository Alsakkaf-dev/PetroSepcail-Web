"use client";

import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { RadioGroup } from "../Form/RadioGroup";
import { Textarea } from "../Form/Textarea";

export interface ReasonOption {
  value: string;
  label: string;
  /** Marks the option that cannot stand on its own — `other_with_note` in
   * `audit.reason_codes`. Selecting it makes the note mandatory. */
  requiresNote?: boolean;
}

export interface ReasonGateProps {
  label: string;
  /** Shared radio-group name; two gates on one screen need two. */
  name: string;
  options: ReasonOption[];
  value: string;
  onChange: (next: string) => void;
  note: string;
  onNoteChange: (next: string) => void;
  noteLabel: string;
  /** Why the note is being asked for. */
  noteHint?: ReactNode;
  /** Shown when nothing is selected yet: "choose a reason code to enable
   * this". Not an error — it is the standing condition. */
  hint?: ReactNode;
  /** The commit control. Rendered here so it and the gate cannot drift
   * apart, and so `disabled` is decided in one place. */
  children: (ready: boolean) => ReactNode;
  className?: string;
}

/** Whether a reason selection is complete enough to act on. Exported so a
 * screen can gate anything else on the same answer without restating the
 * rule. */
export function isReasonReady(options: ReasonOption[], value: string, note: string): boolean {
  const chosen = options.find((option) => option.value === value);
  if (!chosen) return false;
  return chosen.requiresNote ? note.trim().length > 0 : true;
}

/**
 * The gate in front of every admin action that changes someone else's data.
 *
 * `audit.reason_codes` (0064) is a fixed list and the API rejects anything
 * outside it with `INVALID_REASON_CODE`, so this offers the same fixed set —
 * never a free-text field that produces a 422 after the fact. `other_with_note`
 * is the one option that needs the note, and until that note is written the
 * commit control stays disabled.
 *
 * The control is a render prop rather than a slot: "commit is disabled until
 * the reason is valid" is the whole point of the component, and passing the
 * button in as a plain child would let a caller forget to wire it.
 */
export function ReasonGate({
  label,
  name,
  options,
  value,
  onChange,
  note,
  onNoteChange,
  noteLabel,
  noteHint,
  hint,
  children,
  className
}: ReasonGateProps) {
  const chosen = options.find((option) => option.value === value);
  const needsNote = Boolean(chosen?.requiresNote);
  const ready = isReasonReady(options, value, note);

  return (
    <div className={cx("ps-reason", className)}>
      <RadioGroup
        label={label}
        name={name}
        required
        value={value}
        onChange={onChange}
        options={options.map((option) => ({ value: option.value, label: option.label }))}
      />

      {needsNote ? (
        <Textarea
          label={noteLabel}
          hint={typeof noteHint === "string" ? noteHint : undefined}
          required
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
        />
      ) : null}

      {!ready && hint ? (
        <p className="ps-reason__hint">
          <Icon name="info" size="sm" />
          <span>{hint}</span>
        </p>
      ) : null}

      <div className="ps-reason__commit">{children(ready)}</div>
    </div>
  );
}
