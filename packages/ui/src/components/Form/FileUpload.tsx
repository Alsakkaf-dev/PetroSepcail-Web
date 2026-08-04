"use client";

import { useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { describedBy, FieldShell, useFieldIds } from "./Field";

export interface FileUploadProps {
  label: string;
  /** The caller owns the files; this component only collects them. */
  onFiles: (files: File[]) => void;
  /** Already-selected files, so the list survives a re-render. */
  files?: File[];
  onRemove?: (index: number) => void;
  accept?: string;
  multiple?: boolean;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  /** Localized call to action inside the drop zone. */
  browseLabel: string;
  dropLabel?: string;
  removeLabel?: string;
  /** Formats a file's size through the platform's own number formatter. */
  formatSize?: (bytes: number) => string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Bank-transfer proof, POD photo, product media, a return attachment.
 *
 * The real `<input type="file">` stays in the accessibility tree and does the
 * work; the drop zone is a label over it. Drag-and-drop is an addition, never
 * the only route — a keyboard user, a screen-reader user and a driver on a
 * phone all reach the same control through the visible browse button.
 *
 * Nothing here inspects or strips image metadata: EXIF stripping happens
 * server-side, where it cannot be skipped by a client that chose not to. */
export function FileUpload({
  label,
  onFiles,
  files = [],
  onRemove,
  accept,
  multiple = false,
  hint,
  error,
  required,
  browseLabel,
  dropLabel,
  removeLabel,
  formatSize,
  disabled = false,
  id,
  className
}: FileUploadProps) {
  const ids = useFieldIds(id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = Array.from(event.dataTransfer?.files ?? []);
    if (dropped.length > 0) onFiles(multiple ? dropped : dropped.slice(0, 1));
  };

  return (
    <FieldShell
      label={label}
      htmlFor={ids.inputId}
      required={required}
      hint={hint}
      error={error}
      ids={ids}
      className={className}
    >
      <div
        className={cx("ps-upload", dragging && "ps-upload--dragging", disabled && "ps-upload--disabled")}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <Icon name="upload" size="xl" className="ps-upload__icon" />
        {dropLabel ? <p className="ps-upload__drop">{dropLabel}</p> : null}
        <label className="ps-upload__browse" htmlFor={ids.inputId}>
          {browseLabel}
        </label>
        <input
          ref={inputRef}
          id={ids.inputId}
          type="file"
          className="ps-upload__input"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy(ids, hint, error)}
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            if (picked.length > 0) onFiles(picked);
            // Lets the same file be picked again after a removal — without
            // this, re-selecting an identical file fires no change event.
            event.target.value = "";
          }}
        />
      </div>
      {files.length > 0 ? (
        <ul className="ps-upload__files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="ps-upload__file">
              <Icon name="document" size="sm" />
              <span className="ps-upload__file-name">{file.name}</span>
              {formatSize ? <span className="ps-upload__file-size ps-ltr">{formatSize(file.size)}</span> : null}
              {onRemove ? (
                <button
                  type="button"
                  className="ps-upload__remove"
                  onClick={() => onRemove(index)}
                  aria-label={removeLabel ? `${removeLabel} ${file.name}` : undefined}
                >
                  <Icon name="close" size="sm" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </FieldShell>
  );
}
