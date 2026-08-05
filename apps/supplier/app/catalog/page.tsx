"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  Container,
  Icon,
  LineItem,
  LineList,
  Money,
  Page,
  QtyStepper,
  Section,
  SectionHead,
  Skeleton,
  Stack
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";

interface CatalogItem {
  packSizeId: string;
  skuSlug: string;
  nameAr: string;
  nameEn: string;
  tierUnitPrice: string;
  inStock: boolean;
}

// SCR-SP01-001 — EP-SP-001/002. Tier prices only ever reach a supplier
// session; the endpoint enforces role=supplier server-side, and the note under
// the heading is what tells the reader which prices these are.
//
// Was eight inline styles, literal #ddd borders, a bare number input per row,
// bare amounts with no currency and a literal green tick for "added".
export default function CatalogPage() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<{ items: CatalogItem[] }>("/api/v1/supplier/catalog?limit=100")
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

  async function addToCart(packSizeId: string) {
    setBusy(packSizeId);
    setAdded(null);
    setError(null);
    try {
      await authedFetch("/api/v1/supplier/cart", {
        method: "POST",
        body: JSON.stringify({ packSizeId, qty: qty[packSizeId] ?? 1 })
      });
      setAdded(packSizeId);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="catalog-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="catalog-title"
              title={t(locale, "nav.catalog")}
              lead={t(locale, "supplier.tierNote")}
              actions={
                <ButtonLink linkAs={Link} href="/cart" variant="ghost" size="sm">
                  {t(locale, "cart.title")}
                </ButtonLink>
              }
            />

            {error ? (
              <Banner
                tone="danger"
                action={
                  <Button variant="ghost" size="sm" onClick={load}>
                    {t(locale, "common.retry")}
                  </Button>
                }
              >
                {error}
              </Banner>
            ) : null}

            {!items && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="md">
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="md" />
                </Stack>
              </div>
            ) : null}

            {items ? (
              <LineList label={t(locale, "nav.catalog")}>
                {items.map((item) => {
                  const name = locale === "ar" ? item.nameAr : item.nameEn;
                  return (
                    <LineItem
                      key={item.packSizeId}
                      muted={!item.inStock}
                      title={name}
                      meta={
                        <Badge variant={item.inStock ? "success" : "neutral"}>
                          <Icon name={item.inStock ? "check-circle" : "minus"} size="sm" />
                          {item.inStock ? t(locale, "catalog.inStock") : t(locale, "catalog.outOfStock")}
                        </Badge>
                      }
                      control={
                        <QtyStepper
                          label={t(locale, "cart.qtyFor", { name })}
                          value={qty[item.packSizeId] ?? 1}
                          min={1}
                          max={99}
                          disabled={!item.inStock}
                          increaseLabel={t(locale, "cart.increase")}
                          decreaseLabel={t(locale, "cart.decrease")}
                          onChange={(next) => setQty((prev) => ({ ...prev, [item.packSizeId]: next }))}
                        />
                      }
                      price={
                        <>
                          <Money amount={item.tierUnitPrice} locale={locale} emphasis="strong" /> {t(locale, "supplier.exVat")}
                        </>
                      }
                      action={
                        <>
                          <Button
                            variant="gold"
                            size="sm"
                            disabled={!item.inStock}
                            busy={busy === item.packSizeId}
                            onClick={() => addToCart(item.packSizeId)}
                          >
                            {t(locale, "product.addToCart")}
                          </Button>
                          {added === item.packSizeId ? (
                            <span role="status">
                              <Badge variant="success">
                                <Icon name="check-circle" size="sm" />
                                {t(locale, "product.added")}
                              </Badge>
                            </span>
                          ) : null}
                        </>
                      }
                    />
                  );
                })}
              </LineList>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
