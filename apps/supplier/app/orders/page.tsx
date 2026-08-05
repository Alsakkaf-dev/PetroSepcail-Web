"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banner,
  Button,
  ButtonLink,
  Cluster,
  Container,
  DataTable,
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
import { authedFetch, getToken } from "../../lib/authClient";

interface OrderItem {
  orderId: string;
  status: string;
  total: string;
  placedAt: string;
}
interface ReorderLine {
  packSizeId: string;
  skuSlug: string;
  qty: number;
  tierUnitPrice: string;
}
interface ReorderDropped {
  skuSlug: string;
  reason: "discontinued" | "out_of_stock";
}

// SCR-SP08-001's list — EP-SP-004/005 + EP-SP-072. Was a raw <table> with the
// raw order-status enum in its first column and four inline styles.
//
// Reorder re-prices at the current tier and drops discontinued or unavailable
// lines with a notice rather than silently omitting them (FR-SP09-002).
export default function OrdersPage() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<OrderItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<ReorderDropped[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    authedFetch<{ items: OrderItem[] }>("/api/v1/supplier/orders?limit=50")
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

  async function cancelOrder(orderId: string) {
    setBusyId(orderId);
    try {
      await authedFetch(`/api/v1/supplier/orders/${orderId}/cancel`, { method: "POST" });
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusyId(null);
    }
  }

  async function reorder(orderId: string) {
    setBusyId(orderId);
    setDropped([]);
    try {
      const result = await authedFetch<{ lines: ReorderLine[]; dropped: ReorderDropped[] }>(
        `/api/v1/supplier/orders/${orderId}/reorder`,
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
      <Section air="app" aria-labelledby="orders-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="orders-title" title={t(locale, "orders.title")} />

            {dropped.length > 0 ? (
              <Banner tone="warn" title={t(locale, "supplier.templateDropped")}>
                <span className="ps-ltr">{dropped.map((line) => line.skuSlug).join(", ")}</span>
              </Banner>
            ) : null}

            <DataTable
              caption={t(locale, "orders.title")}
              state={state}
              stickyHeader
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "orders.empty")}
              emptyAction={
                <ButtonLink linkAs={Link} href="/catalog" variant="gold">
                  {t(locale, "nav.catalog")}
                </ButtonLink>
              }
              rows={items ?? []}
              getRowKey={(row) => row.orderId}
              columns={[
                {
                  key: "orderId",
                  header: t(locale, "orders.orderNumber"),
                  emphasis: "primary",
                  render: (row) => (
                    <IdDisplay
                      id={row.orderId}
                      copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                    />
                  )
                },
                {
                  key: "status",
                  header: t(locale, "orders.timeline"),
                  render: (row) => <StatusBadge kind="order" value={row.status} locale={locale} />
                },
                {
                  key: "placedAt",
                  header: t(locale, "orders.placedAt"),
                  render: (row) => <DateTime iso={row.placedAt} locale={locale} />
                },
                {
                  key: "total",
                  header: t(locale, "cart.total"),
                  align: "end",
                  render: (row) => <Money amount={row.total} locale={locale} emphasis="strong" />
                },
                {
                  key: "actions",
                  header: t(locale, "common.showMore"),
                  headerHidden: true,
                  align: "end",
                  render: (row) => (
                    <Cluster gap="sm" justify="end">
                      <ButtonLink linkAs={Link} href={`/orders/${row.orderId}`} variant="ghost" size="sm">
                        {t(locale, "orders.track")}
                      </ButtonLink>
                      <Button variant="ghost" size="sm" busy={busyId === row.orderId} onClick={() => reorder(row.orderId)}>
                        {t(locale, "orders.reorder")}
                      </Button>
                      {/* Cancel is absent, not disabled, once the order has
                          moved past payment — there is no state behind it. */}
                      {row.status === "pending_payment" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          busy={busyId === row.orderId}
                          onClick={() => cancelOrder(row.orderId)}
                        >
                          {t(locale, "orders.cancel")}
                        </Button>
                      ) : null}
                    </Cluster>
                  )
                }
              ]}
            />
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
