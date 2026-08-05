"use client";

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { describedBy, FieldShell, useFieldIds } from "./Field";

export interface ComboboxOption {
  /** What the input becomes when this option is chosen. */
  value: string;
  label: ReactNode;
  /** A second line — what kind of thing this is, where it will take you. */
  description?: ReactNode;
  /** Anything the caller needs back on select and cannot recover from
   * `value` — a slug, an id. Passed through untouched. */
  meta?: string;
}

export interface ComboboxProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: ComboboxOption[];
  /** Fired on click, on Enter over a highlighted option, and never on a bare
   * keystroke — typing must not navigate. */
  onSelect: (option: ComboboxOption) => void;
  /** Submitting the raw text rather than a suggestion. Enter with nothing
   * highlighted goes here, which is how someone searches for a term that is
   * not in the list. */
  onSubmit?: (value: string) => void;
  hint?: string;
  placeholder?: string;
  /** Already localised and already counted — "3 suggestions". Announced
   * politely, so a screen reader hears the list change without the focus
   * moving. */
  status?: string;
  /** Localised name for the clear button. Omit it and no clear button
   * renders. */
  clearLabel?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * Search-as-you-type over a list the server produces.
 *
 * The one control in this system that genuinely needs hand-written ARIA —
 * `Select` covers every closed set, and a `<datalist>` cannot be styled, cannot
 * carry a second line per option, and behaves differently in every browser.
 *
 * What it implements, and why each part is not optional:
 *  - `role="combobox"` on the input with `aria-expanded` and `aria-controls`,
 *    so the relationship between the field and the list is stated rather than
 *    implied by proximity.
 *  - `aria-activedescendant` rather than moving DOM focus, so the caret stays
 *    in the input while the highlight moves down the list.
 *  - Arrow keys move the highlight, Enter takes the highlighted option,
 *    Escape closes the list and leaves the text alone. Typing never
 *    navigates.
 *  - A polite live region announcing how many suggestions there are. A list
 *    that appears silently is a list that only sighted users know about.
 */
export function Combobox({
  label,
  value,
  onChange,
  options,
  onSelect,
  onSubmit,
  hint,
  placeholder,
  status,
  clearLabel,
  disabled = false,
  id,
  className
}: ComboboxProps) {
  const ids = useFieldIds(id);
  const listId = `${ids.inputId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const expanded = open && options.length > 0;

  const choose = useCallback(
    (option: ComboboxOption) => {
      onSelect(option);
      setOpen(false);
      setActive(-1);
    },
    [onSelect]
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((prev) => {
        const next = prev + step;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "Enter") {
      const highlighted = active >= 0 ? options[active] : undefined;
      if (highlighted) {
        event.preventDefault();
        choose(highlighted);
      } else if (onSubmit) {
        event.preventDefault();
        setOpen(false);
        onSubmit(value);
      }
    }
  }

  return (
    <FieldShell label={label} htmlFor={ids.inputId} hint={hint} ids={ids} className={cx("ps-combobox", className)}>
      <div className="ps-combobox__control">
        <span className="ps-combobox__icon" aria-hidden="true">
          <Icon name="search" size="sm" />
        </span>
        <input
          ref={inputRef}
          id={ids.inputId}
          type="text"
          role="combobox"
          className="ps-combobox__input"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={describedBy(ids, hint)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          // A click inside the list would blur the input before the click
          // lands, so the close is deferred by one turn.
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        />
        {clearLabel && value ? (
          <button
            type="button"
            className="ps-combobox__clear"
            aria-label={clearLabel}
            onClick={() => {
              onChange("");
              setActive(-1);
              inputRef.current?.focus();
            }}
          >
            <Icon name="close" size="sm" />
          </button>
        ) : null}
      </div>

      <ul id={listId} role="listbox" aria-label={label} className={cx("ps-combobox__list", expanded && "is-open")}>
        {expanded
          ? options.map((option, index) => (
              <li
                key={`${option.value}-${index}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={cx("ps-combobox__option", index === active && "is-active")}
                onMouseDown={() => choose(option)}
                onMouseEnter={() => setActive(index)}
              >
                <span className="ps-combobox__option-label">{option.label}</span>
                {option.description ? (
                  <span className="ps-combobox__option-desc">{option.description}</span>
                ) : null}
              </li>
            ))
          : null}
      </ul>

      <p className="ps-visually-hidden" role="status" aria-live="polite">
        {expanded ? status : ""}
      </p>
    </FieldShell>
  );
}
