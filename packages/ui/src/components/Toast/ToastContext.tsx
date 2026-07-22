import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ToastVariant = "info" | "success" | "error";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms before auto-dismiss; 0 disables auto-dismiss. */
  duration?: number;
}

export interface ToastItem extends Required<Pick<ToastInput, "title" | "variant" | "duration">> {
  id: string;
  description?: string;
}

interface ToastContextValue {
  toasts: ToastItem[];
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = `toast-${(nextId.current += 1)}`;
      const item: ToastItem = {
        id,
        title: toast.title,
        description: toast.description,
        variant: toast.variant ?? "info",
        duration: toast.duration ?? 5000
      };
      setToasts((prev) => [...prev, item]);
      if (item.duration > 0) {
        setTimeout(() => dismiss(id), item.duration);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
