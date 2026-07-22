"use client";

import { useState } from "react";
import { authedFetch, getToken } from "../lib/authClient";

export function AddToCartButton({ packSizeId, locale }: { packSizeId: string; locale: "ar" | "en" }) {
  const [status, setStatus] = useState<"idle" | "added" | "error" | "signin">("idle");

  async function add() {
    if (!getToken()) {
      setStatus("signin");
      return;
    }
    try {
      await authedFetch("/api/v1/cart/lines", { method: "POST", body: JSON.stringify({ packSizeId, qty: 1 }) });
      setStatus("added");
    } catch {
      setStatus("error");
    }
  }

  const label = {
    ar: { idle: "أضف إلى السلة", added: "أُضيف ✓", error: "حدث خطأ", signin: "سجّل الدخول من صفحة السلة أولًا" },
    en: { idle: "Add to cart", added: "Added ✓", error: "Failed", signin: "Sign in from the cart page first" }
  }[locale];

  return (
    <button
      type="button"
      onClick={add}
      style={{ padding: "10px 20px", borderRadius: 8, background: "var(--gold)", border: "none", fontWeight: 700 }}
    >
      {label[status]}
    </button>
  );
}
