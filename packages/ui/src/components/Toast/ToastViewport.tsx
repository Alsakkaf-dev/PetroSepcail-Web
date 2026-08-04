"use client";

import { cx } from "../../utils/cx";
import { useToast } from "./ToastContext";

export interface ToastViewportProps {
  dismissLabel?: string;
}

/** PC-08 core set. Positioned `inset-block-start`/`inset-inline-start`
 * (PC-08 §3: "toasts (top-inline-start in RTL)") so it sits top-right in
 * AR/RTL and top-left in EN/LTR without any direction-specific code here. */
export function ToastViewport({ dismissLabel = "Dismiss" }: ToastViewportProps) {
  const { toasts, dismiss } = useToast();

  return (
    <div className="ps-toast-viewport">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx("ps-toast", `ps-toast--${toast.variant}`)}
          role={toast.variant === "error" ? "alert" : "status"}
        >
          <div className="ps-toast__body">
            <p className="ps-toast__title">{toast.title}</p>
            {toast.description ? <p className="ps-toast__description">{toast.description}</p> : null}
          </div>
          <button type="button" className="ps-toast__dismiss" onClick={() => dismiss(toast.id)} aria-label={dismissLabel}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
