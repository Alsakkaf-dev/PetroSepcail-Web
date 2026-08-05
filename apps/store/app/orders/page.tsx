"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ButtonLink,
  Container,
  DataList,
  DateTime,
  IdDisplay,
  Money,
  Page,
  Section,
  SectionHead,
  Stack,
  StatusBadge
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { LoginForm } from "../../components/LoginForm";
import { authedFetch, getToken, isSessionEnded } from "../../lib/authClient";

interface OrderListItem {
  orderId: string;
  status: string;
  total: string;
  paymentMethod: string;
  placedAt: string;
  slot: string;
}

// EP-SF-030 / SCR-SF05-001. Was three near-identical bare rows, each showing a
// status word, a date and a price and nothing else — no order reference, no
// items, no way to tell one from another.
//
// The date bug the owner spotted lives here too: the app's own
// localeDateString() called toLocaleDateString("ar-SA"), which renders
// Arabic-Indic digits (٢٠٢٦/٨/٤) while every price beside it rendered Western.
// packages/i18n formats through `ar-SA-u-nu-latn` precisely so the platform
// uses one set of numerals; <DateTime> is that formatter.
export default function OrdersListPage() {
  const locale = useLocale();
  const [loggedIn, setLoggedIn] = useState<boolean | undefined>(undefined);
  const [items, setItems] = useState<OrderListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(Boolean(getToken()));
  }, []);

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    authedFetch<{ items: OrderListItem[] }>("/api/v1/orders")
      .then((res) => setItems(res.items))
      .catch((thrown) => {
        // An expired session goes back to the sign-in card, not to an error
        // message sitting beside a hidden one.
        if (isSessionEnded(thrown)) return setLoggedIn(false);
        setError(messageFor(locale, thrown));
      });
  }, [locale]);

  useEffect(() => {
    if (loggedIn) load();
  }, [loggedIn, load]);

  const state = error ? "error" : items === null ? "loading" : items.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="orders-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="orders-title" title={t(locale, "orders.title")} />

            {loggedIn === false ? <LoginForm promptKey="auth.leadOrders" onLoggedIn={() => setLoggedIn(true)} /> : null}

            {loggedIn ? (
              <DataList
                label={t(locale, "orders.title")}
                state={state}
                emptyTitle={t(locale, "orders.empty")}
                emptyAction={
                  <ButtonLink href="/catalog" variant="gold">
                    {t(locale, "catalog.browse")}
                  </ButtonLink>
                }
                errorMessage={error ?? undefined}
                onRetry={load}
                retryLabel={t(locale, "common.retry")}
                items={(items ?? []).map((order) => ({
                  id: order.orderId,
                  href: `/orders/${order.orderId}`,
                  // Never the raw UUID as the label: it is not something a
                  // customer can read back over the phone. IdDisplay truncates
                  // it and carries the full value for copying.
                  title: (
                    <IdDisplay
                      id={order.orderId}
                      label={t(locale, "orders.orderNumber")}
                      copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                    />
                  ),
                  status: <StatusBadge kind="order" value={order.status} locale={locale} />,
                  fields: [
                    { label: t(locale, "orders.placedAt"), value: <DateTime iso={order.placedAt} locale={locale} /> },
                    { label: t(locale, "cart.total"), value: <Money amount={order.total} locale={locale} emphasis="strong" /> }
                  ]
                }))}
              />
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
