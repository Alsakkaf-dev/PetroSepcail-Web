"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banner,
  Button,
  Card,
  Cluster,
  Container,
  DataList,
  Ltr,
  Page,
  Section,
  SectionHead,
  Stack,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";

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

// SCR-SP09-001 — EP-SP-070/071. Templates store no price (FR-SP09-001): they
// are re-priced at the current tier every time they are used, which is what
// the note under the heading says rather than leaving it to be discovered.
//
// Was six inline styles, literal #ddd borders and a `var(--flame, #b45309)`
// fallback colour for the dropped-lines notice — a token with a hardcoded
// escape hatch behind it.
export default function TemplatesPage() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<TemplateItem[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<ReorderDropped[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setError(null);
    authedFetch<{ items: TemplateItem[] }>("/api/v1/supplier/templates")
      .then((res) => setItems(res.items))
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
  }, [load, router]);

  // Saving the current cart under a name reuses the cart the distributor has
  // already built, rather than duplicating the catalogue picker on this screen
  // as well.
  async function createFromCart(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const cart = await authedFetch<{ lines: CartLine[] }>("/api/v1/supplier/cart");
      if (cart.lines.length === 0) {
        setError(t(locale, "cart.empty"));
        return;
      }
      await authedFetch("/api/v1/supplier/templates", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          lines: cart.lines.map((line) => ({ packSizeId: line.packSizeId, qty: line.qty }))
        })
      });
      setName("");
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setCreating(false);
    }
  }

  async function deleteTemplate(id: string) {
    setBusyId(id);
    try {
      await authedFetch(`/api/v1/supplier/templates/${id}`, { method: "DELETE" });
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
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
        await authedFetch("/api/v1/supplier/cart", {
          method: "POST",
          body: JSON.stringify({ packSizeId: line.packSizeId, qty: line.qty })
        });
      }
      setDropped(result.dropped);
      router.push("/cart");
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusyId(null);
    }
  }

  const state = error ? "error" : items === null ? "loading" : items.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="templates-title">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="templates-title"
              title={t(locale, "nav.templates")}
              lead={t(locale, "supplier.templateRepriced")}
            />

            {dropped.length > 0 ? (
              <Banner tone="warn" title={t(locale, "supplier.templateDropped")}>
                <Ltr>{dropped.map((line) => line.skuSlug).join(", ")}</Ltr>
              </Banner>
            ) : null}

            <Card>
              <form onSubmit={createFromCart}>
                <Cluster gap="md" align="end">
                  <TextField
                    label={t(locale, "supplier.templateName")}
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <Button type="submit" variant="gold" busy={creating}>
                    {t(locale, "supplier.createTemplate")}
                  </Button>
                </Cluster>
              </form>
            </Card>

            <DataList
              label={t(locale, "nav.templates")}
              state={state}
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "supplier.noTemplates")}
              emptyDescription={t(locale, "supplier.noTemplatesHint")}
              items={(items ?? []).map((template) => ({
                id: template.templateId,
                title: template.name,
                fields: [{ label: t(locale, "orders.items"), value: <Ltr>{count(template.lines.length)}</Ltr> }],
                actions: (
                  <Cluster gap="sm">
                    <Button
                      variant="gold"
                      size="sm"
                      busy={busyId === template.templateId}
                      onClick={() => reorderFromTemplate(template.templateId)}
                    >
                      {t(locale, "supplier.reorderFromTemplate")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      busy={busyId === template.templateId}
                      onClick={() => deleteTemplate(template.templateId)}
                    >
                      {t(locale, "common.remove")}
                    </Button>
                  </Cluster>
                )
              }))}
            />
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
