"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch, getToken } from "../../lib/authClient";
import { dirFor, t } from "../../lib/locale";
import { useLocale } from "../../lib/useLocale";

interface TemplateLine {
  packSizeId: string;
  qty: number;
}
interface TemplateItem {
  templateId: string;
  name: string;
  lines: TemplateLine[];
}
interface CartLine {
  packSizeId: string;
  qty: number;
}
interface ReorderDropped {
  skuSlug: string;
  reason: "discontinued" | "out_of_stock";
}

// EP-SP-070/071 (SP-09, S16) — templates store no price (FR-SP09-001),
// re-priced fresh at reorder. "Create template" saves the current cart's
// lines under a name — reuses the cart the supplier already built instead
// of duplicating the catalog picker UI on this screen too.
export default function TemplatesPage() {
  return (
    <Suspense fallback={null}>
      <TemplatesPageInner />
    </Suspense>
  );
}

function TemplatesPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<TemplateItem[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<ReorderDropped[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    authedFetch<{ items: TemplateItem[] }>("/api/v1/supplier/templates")
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, router]);

  async function createFromCart(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      const cart = await authedFetch<{ lines: CartLine[] }>("/api/v1/supplier/cart");
      if (cart.lines.length === 0) {
        setError(t(locale, "cartEmpty"));
        return;
      }
      await authedFetch("/api/v1/supplier/templates", {
        method: "POST",
        body: JSON.stringify({ name, lines: cart.lines.map((l) => ({ packSizeId: l.packSizeId, qty: l.qty })) })
      });
      setName("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    }
  }

  async function deleteTemplate(id: string) {
    setBusyId(id);
    try {
      await authedFetch(`/api/v1/supplier/templates/${id}`, { method: "DELETE" });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusyId(null);
    }
  }

  async function reorderFromTemplate(id: string) {
    setBusyId(id);
    setDropped([]);
    try {
      const result = await authedFetch<{ lines: Array<{ packSizeId: string; qty: number }>; dropped: ReorderDropped[] }>(
        `/api/v1/supplier/templates/${id}/reorder`,
        { method: "POST" }
      );
      for (const line of result.lines) {
        await authedFetch("/api/v1/supplier/cart", { method: "POST", body: JSON.stringify({ packSizeId: line.packSizeId, qty: line.qty }) });
      }
      setDropped(result.dropped);
      router.push(`/cart?lang=${locale}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusyId(null);
    }
  }


  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1>{t(locale, "templatesTitle")}</h1>
      {error && <p role="alert">{error}</p>}
      {dropped.length > 0 && (
        <p style={{ color: "var(--flame, #b45309)" }}>
          {t(locale, "droppedLinesNotice")} ({dropped.map((d) => d.skuSlug).join(", ")})
        </p>
      )}

      <form onSubmit={createFromCart} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t(locale, "templateName")} />
        <button type="submit">{t(locale, "createTemplate")}</button>
      </form>

      {items && items.length === 0 && <p>{t(locale, "noTemplates")}</p>}

      {items && items.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {items.map((tpl) => (
            <li key={tpl.templateId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
              <span>
                {tpl.name} ({tpl.lines.length})
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={busyId === tpl.templateId} onClick={() => reorderFromTemplate(tpl.templateId)}>
                  {t(locale, "reorderAction")}
                </button>
                <button type="button" disabled={busyId === tpl.templateId} onClick={() => deleteTemplate(tpl.templateId)}>
                  {t(locale, "remove")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
