"use client";

import { useState } from "react";
import { authedFetch, getToken, NETWORK_ERROR, SESSION_EXPIRED } from "../lib/authClient";

export function AddToCartButton({ packSizeId, locale }: { packSizeId: string; locale: "ar" | "en" }) {
  const [status, setStatus] = useState<"idle" | "added" | "error" | "signin" | "offline">("idle");
  // The API's own message (out of stock, quantity cap, ...) — far more use to
  // a customer than the blanket "Failed" this button used to show for every
  // possible cause, including an expired session it could have recovered from.
  const [detail, setDetail] = useState<string | null>(null);

  async function add() {
    setDetail(null);
    if (!getToken()) {
      setStatus("signin");
      return;
    }
    try {
      await authedFetch("/api/v1/cart/lines", { method: "POST", body: JSON.stringify({ packSizeId, qty: 1 }) });
      setStatus("added");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === SESSION_EXPIRED || message === "NOT_LOGGED_IN") setStatus("signin");
      else if (message === NETWORK_ERROR) setStatus("offline");
      else {
        setStatus("error");
        setDetail(message || null);
      }
    }
  }

  const label = {
    ar: {
      idle: "أضف إلى السلة",
      added: "أُضيف ✓",
      error: "تعذّرت الإضافة",
      signin: "سجّل الدخول من صفحة السلة أولًا",
      offline: "تعذّر الاتصال، حاول مجددًا"
    },
    en: {
      idle: "Add to cart",
      added: "Added ✓",
      error: "Could not add",
      signin: "Sign in from the cart page first",
      offline: "Connection failed, try again"
    }
  }[locale];

  return (
    <div style={{ display: "grid", gap: 4, justifyItems: locale === "ar" ? "end" : "start" }}>
      <button
        type="button"
        onClick={add}
        style={{ padding: "10px 20px", borderRadius: 8, background: "var(--gold)", border: "none", fontWeight: 700 }}
      >
        {label[status]}
      </button>
      {detail && <span style={{ color: "#b91c1c", fontSize: 12 }}>{detail}</span>}
    </div>
  );
}
