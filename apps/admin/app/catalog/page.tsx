"use client";

import type { AdminSkuListResponse } from "@petrospecial/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Cluster,
  Container,
  DataTable,
  Icon,
  Ltr,
  Money,
  Page,
  QtyStepper,
  Section,
  SectionHead,
  Stack,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

interface Row {
  skuId: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  packSizeId: string;
  sizeLabel: string;
  retailPrice: string | null;
  qtyOnHand: number;
  reserved: number;
}

// SCR-AC02-002 — AC-02, prices and inventory.
//
// Was twelve inline styles, a raw <table>, and — the part that mattered most —
// its own private sign-in form and its own private `api()` helper, because
// this screen predates the console shell. Both are gone: it goes through the
// same LoginGate and the same authedFetch as every other page, so a session
// that expires here behaves the way it does everywhere else.
//
// The forward-only notice is permanent, not conditional: a price change never
// re-prices an invoice that has already been issued, and an operator has to
// know that before they type a number, not after a distributor calls.
function CatalogInner() {
  const locale = useLocale();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<AdminSkuListResponse>("/api/v1/admin/catalog/skus")
      .then((res) => {
        const items = res.items as Row[];
        setRows(items);
        setPrices(Object.fromEntries(items.map((row) => [row.packSizeId, row.retailPrice ?? ""])));
        setQuantities(Object.fromEntries(items.map((row) => [row.packSizeId, row.qtyOnHand])));
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  async function savePrice(row: Row) {
    setBusy(`${row.packSizeId}-price`);
    setDone(null);
    try {
      await authedFetch("/api/v1/admin/catalog/prices", {
        method: "PUT",
        body: JSON.stringify({ packSizeId: row.packSizeId, retailPrice: prices[row.packSizeId] })
      });
      setDone(t(locale, "common.saved"));
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  async function saveStock(row: Row) {
    setBusy(`${row.packSizeId}-stock`);
    setDone(null);
    try {
      await authedFetch("/api/v1/admin/catalog/inventory", {
        method: "PUT",
        body: JSON.stringify({ packSizeId: row.packSizeId, qtyOnHand: quantities[row.packSizeId] })
      });
      setDone(t(locale, "common.saved"));
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  const state = error ? "error" : rows === null ? "loading" : rows.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="catalog-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="catalog-title" title={t(locale, "nav.catalog")} />

            <Banner tone="info">{t(locale, "admin.pricesForwardOnly")}</Banner>

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

            {done ? (
              <span role="status">
                <Badge variant="success">
                  <Icon name="check-circle" size="sm" />
                  {done}
                </Badge>
              </span>
            ) : null}

            <DataTable
              caption={t(locale, "nav.catalog")}
              state={state}
              stickyHeader
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "admin.catalogEmpty")}
              emptyDescription={t(locale, "admin.catalogEmptyHint")}
              rows={rows ?? []}
              getRowKey={(row) => row.packSizeId}
              columns={[
                { key: "nameAr", header: t(locale, "admin.skuNameAr"), emphasis: "primary", render: (row) => row.nameAr },
                { key: "nameEn", header: t(locale, "admin.skuNameEn"), render: (row) => <Ltr>{row.nameEn}</Ltr> },
                { key: "size", header: t(locale, "catalog.packSize"), render: (row) => <Ltr>{row.sizeLabel}</Ltr> },
                {
                  key: "currentPrice",
                  header: t(locale, "admin.retailPrice"),
                  align: "end",
                  render: (row) => (row.retailPrice ? <Money amount={row.retailPrice} locale={locale} /> : "—")
                },
                {
                  key: "price",
                  header: t(locale, "admin.savePrice"),
                  render: (row) => (
                    <Cluster gap="sm">
                      <TextField
                        label={t(locale, "admin.retailPrice")}
                        forceLtr
                        inputMode="decimal"
                        value={prices[row.packSizeId] ?? ""}
                        onChange={(event) =>
                          setPrices((prev) => ({ ...prev, [row.packSizeId]: event.target.value }))
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        busy={busy === `${row.packSizeId}-price`}
                        onClick={() => savePrice(row)}
                      >
                        {t(locale, "admin.savePrice")}
                      </Button>
                    </Cluster>
                  )
                },
                {
                  key: "reserved",
                  header: t(locale, "admin.reserved"),
                  align: "end",
                  render: (row) => <Ltr>{count(row.reserved)}</Ltr>
                },
                {
                  key: "stock",
                  header: t(locale, "admin.saveStock"),
                  render: (row) => (
                    <Cluster gap="sm">
                      <QtyStepper
                        label={t(locale, "admin.qtyOnHand")}
                        value={quantities[row.packSizeId] ?? 0}
                        min={0}
                        max={9999}
                        increaseLabel={t(locale, "cart.increase")}
                        decreaseLabel={t(locale, "cart.decrease")}
                        onChange={(next) => setQuantities((prev) => ({ ...prev, [row.packSizeId]: next }))}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        busy={busy === `${row.packSizeId}-stock`}
                        onClick={() => saveStock(row)}
                      >
                        {t(locale, "admin.saveStock")}
                      </Button>
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

export default function CatalogPage() {
  return (
    <LoginGate>
      <CatalogInner />
    </LoginGate>
  );
}
