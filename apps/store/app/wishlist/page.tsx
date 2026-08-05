"use client";

import type { WishlistResponse } from "@petrospecial/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  Container,
  EmptyState,
  Icon,
  IconWell,
  LineItem,
  LineList,
  LineNote,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  Switch
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { LoginForm } from "../../components/LoginForm";
import { authedFetch, getToken, isSessionEnded } from "../../lib/authClient";

type WishlistItem = WishlistResponse["items"][number];

// SCR-SF09-001. Was a bare `<ul>` of "name — in stock" with a remove button
// and two `locale === "ar" ? … : …` copy ternaries.
//
// One thing this screen deliberately does not do: add straight to the cart.
// EP-SF-070 returns a SKU, and the cart takes a pack size (EP-SF-011 wants a
// `packSizeId`) — a SKU has several. Guessing one for the customer would put a
// litre in the basket when they wanted four. So the primary action is the
// product page, where the sizes and their prices are, and the reason is said
// out loud rather than left as a missing button.
export default function WishlistPage() {
  const locale = useLocale();
  const [loggedIn, setLoggedIn] = useState<boolean | undefined>(undefined);
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(Boolean(getToken()));
  }, []);

  const load = useCallback(() => {
    setError(null);
    authedFetch<WishlistResponse>("/api/v1/wishlist")
      .then((res) => setItems(res.items))
      .catch((thrown) => {
        if (isSessionEnded(thrown)) return setLoggedIn(false);
        setError(messageFor(locale, thrown));
      });
  }, [locale]);

  useEffect(() => {
    if (loggedIn) load();
  }, [loggedIn, load]);

  async function remove(skuId: string) {
    setBusy(skuId);
    try {
      await authedFetch(`/api/v1/wishlist/${skuId}`, { method: "DELETE" });
      setItems((prev) => (prev ?? []).filter((item) => item.skuId !== skuId));
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  // EP-SF-073. Optimistic, because a toggle that waits on a round trip before
  // it moves reads as broken and gets clicked twice — which here means opting
  // out again straight after opting in.
  async function setBackInStock(skuId: string, optin: boolean) {
    setItems((prev) => (prev ?? []).map((item) => (item.skuId === skuId ? { ...item, backInStockOptin: optin } : item)));
    try {
      await authedFetch(`/api/v1/wishlist/${skuId}/back-in-stock`, {
        method: "POST",
        body: JSON.stringify({ optin })
      });
    } catch (thrown) {
      setError(messageFor(locale, thrown));
      setItems((prev) =>
        (prev ?? []).map((item) => (item.skuId === skuId ? { ...item, backInStockOptin: !optin } : item))
      );
    }
  }

  const loading = loggedIn && items === null && !error;

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="wishlist-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="wishlist-title" title={t(locale, "wishlist.title")} />

            {loggedIn === false ? <LoginForm promptKey="auth.leadAccount" onLoggedIn={() => setLoggedIn(true)} /> : null}

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

            {loading ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="md">
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="md" />
                </Stack>
              </div>
            ) : null}

            {items !== null && items.length === 0 ? (
              <EmptyState
                illustration={<IconWell name="heart" tone="gold" />}
                title={t(locale, "wishlist.empty")}
                description={t(locale, "wishlist.emptyHint")}
                action={
                  <ButtonLink linkAs={Link} href="/catalog" variant="gold">
                    {t(locale, "catalog.browse")}
                  </ButtonLink>
                }
              />
            ) : null}

            {items !== null && items.length > 0 ? (
              <LineList label={t(locale, "wishlist.itemsLabel")}>
                {items.map((item) => {
                  const name = locale === "ar" ? item.nameAr : item.nameEn;
                  return (
                    <LineItem
                      key={item.skuId}
                      muted={!item.anyInStock}
                      title={name}
                      meta={
                        <Badge variant={item.anyInStock ? "success" : "neutral"}>
                          <Icon name={item.anyInStock ? "check-circle" : "minus"} size="sm" />
                          {item.anyInStock ? t(locale, "catalog.inStock") : t(locale, "catalog.outOfStock")}
                        </Badge>
                      }
                      notes={
                        !item.anyInStock ? (
                          <Switch
                            label={t(locale, "wishlist.backInStock")}
                            description={t(locale, "wishlist.backInStockHint")}
                            checked={item.backInStockOptin}
                            onChange={(next) => setBackInStock(item.skuId, next)}
                          />
                        ) : (
                          <LineNote tone="muted">{t(locale, "wishlist.pickSizeAtProduct")}</LineNote>
                        )
                      }
                      action={
                        <>
                          <ButtonLink linkAs={Link} href={`/catalog/${item.slug}`} variant="gold" size="sm">
                            {t(locale, "catalog.viewProduct")}
                          </ButtonLink>
                          <Button
                            variant="ghost"
                            size="sm"
                            busy={busy === item.skuId}
                            aria-label={t(locale, "wishlist.remove", { name })}
                            onClick={() => remove(item.skuId)}
                          >
                            {t(locale, "common.remove")}
                          </Button>
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
