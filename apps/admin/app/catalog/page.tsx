"use client";

import type { AdminSkuListResponse } from "@petrospecial/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
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
  Select,
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

  const [skuSlug, setSkuSlug] = useState("");
  const [skuFamily, setSkuFamily] = useState<"special" | "petro" | "raval">("special");
  const [skuNameAr, setSkuNameAr] = useState("");
  const [skuNameEn, setSkuNameEn] = useState("");
  const [skuGrade, setSkuGrade] = useState("");
  const [skuApplication, setSkuApplication] = useState<
    "petrol_engine" | "diesel_engine" | "coolant" | "brake_fluid" | "gear_fluid"
  >("petrol_engine");
  const [skuProductTypeAr, setSkuProductTypeAr] = useState("");
  const [skuProductTypeEn, setSkuProductTypeEn] = useState("");
  const [createSkuBusy, setCreateSkuBusy] = useState(false);
  const [createSkuError, setCreateSkuError] = useState<string | null>(null);
  const [createSkuDone, setCreateSkuDone] = useState<string | null>(null);

  const [packSkuId, setPackSkuId] = useState("");
  const [packSizeLabel, setPackSizeLabel] = useState("");
  const [packSizeLiters, setPackSizeLiters] = useState("");
  const [createPackBusy, setCreatePackBusy] = useState(false);
  const [createPackError, setCreatePackError] = useState<string | null>(null);
  const [createPackDone, setCreatePackDone] = useState<string | null>(null);

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

  async function createSku(event: React.FormEvent) {
    event.preventDefault();
    setCreateSkuBusy(true);
    setCreateSkuError(null);
    try {
      await authedFetch("/api/v1/admin/catalog/skus", {
        method: "POST",
        body: JSON.stringify({
          slug: skuSlug.trim(),
          familyCode: skuFamily,
          nameAr: skuNameAr.trim(),
          nameEn: skuNameEn.trim(),
          grade: skuGrade.trim(),
          application: skuApplication,
          productTypeAr: skuProductTypeAr.trim(),
          productTypeEn: skuProductTypeEn.trim()
        })
      });
      setCreateSkuDone(t(locale, "admin.skuCreated"));
      setSkuSlug("");
      setSkuNameAr("");
      setSkuNameEn("");
      setSkuGrade("");
      setSkuProductTypeAr("");
      setSkuProductTypeEn("");
      load();
    } catch (thrown) {
      setCreateSkuError(messageFor(locale, thrown));
    } finally {
      setCreateSkuBusy(false);
    }
  }

  const skuOptions = useMemo(() => {
    const bySkuId = new Map<string, Row>();
    for (const row of rows ?? []) if (!bySkuId.has(row.skuId)) bySkuId.set(row.skuId, row);
    return Array.from(bySkuId.values()).map((row) => ({ value: row.skuId, label: `${row.nameAr} / ${row.nameEn}` }));
  }, [rows]);

  async function createPackSize(event: React.FormEvent) {
    event.preventDefault();
    setCreatePackBusy(true);
    setCreatePackError(null);
    try {
      const sizeLiters = Number(packSizeLiters);
      await authedFetch("/api/v1/admin/catalog/pack-sizes", {
        method: "POST",
        body: JSON.stringify({ skuId: packSkuId, sizeLabel: packSizeLabel.trim(), sizeLiters })
      });
      setCreatePackDone(t(locale, "admin.packSizeCreated"));
      setPackSkuId("");
      setPackSizeLabel("");
      setPackSizeLiters("");
      load();
    } catch (thrown) {
      setCreatePackError(messageFor(locale, thrown));
    } finally {
      setCreatePackBusy(false);
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

            <Stack gap="md">
              <h2 className="ps-section-head__title">{t(locale, "admin.createSkuSection")}</h2>
              <Banner tone="info">{t(locale, "admin.createSkuHint")}</Banner>
              <Card>
                <form onSubmit={createSku}>
                  <Stack gap="md">
                    <TextField
                      label={t(locale, "admin.slug")}
                      hint={t(locale, "admin.slugHint")}
                      required
                      forceLtr
                      value={skuSlug}
                      onChange={(e) => setSkuSlug(e.target.value)}
                    />
                    <Select
                      label={t(locale, "admin.family")}
                      value={skuFamily}
                      onChange={(e) => setSkuFamily(e.target.value as typeof skuFamily)}
                      options={[
                        { value: "special", label: t(locale, "admin.familySpecial") },
                        { value: "petro", label: t(locale, "admin.familyPetro") },
                        { value: "raval", label: t(locale, "admin.familyRaval") }
                      ]}
                    />
                    <TextField
                      label={t(locale, "admin.skuNameAr")}
                      required
                      value={skuNameAr}
                      onChange={(e) => setSkuNameAr(e.target.value)}
                    />
                    <TextField
                      label={t(locale, "admin.skuNameEn")}
                      required
                      forceLtr
                      value={skuNameEn}
                      onChange={(e) => setSkuNameEn(e.target.value)}
                    />
                    <TextField
                      label={t(locale, "catalog.grade")}
                      required
                      forceLtr
                      value={skuGrade}
                      onChange={(e) => setSkuGrade(e.target.value)}
                    />
                    <Select
                      label={t(locale, "catalog.application")}
                      value={skuApplication}
                      onChange={(e) => setSkuApplication(e.target.value as typeof skuApplication)}
                      options={[
                        { value: "petrol_engine", label: t(locale, "app.petrol_engine") },
                        { value: "diesel_engine", label: t(locale, "app.diesel_engine") },
                        { value: "coolant", label: t(locale, "app.coolant") },
                        { value: "brake_fluid", label: t(locale, "app.brake_fluid") },
                        { value: "gear_fluid", label: t(locale, "app.gear_fluid") }
                      ]}
                    />
                    <TextField
                      label={t(locale, "admin.productTypeAr")}
                      required
                      value={skuProductTypeAr}
                      onChange={(e) => setSkuProductTypeAr(e.target.value)}
                    />
                    <TextField
                      label={t(locale, "admin.productTypeEn")}
                      required
                      forceLtr
                      value={skuProductTypeEn}
                      onChange={(e) => setSkuProductTypeEn(e.target.value)}
                    />
                    {createSkuError ? <Banner tone="danger">{createSkuError}</Banner> : null}
                    {createSkuDone ? (
                      <span role="status">
                        <Badge variant="success">
                          <Icon name="check-circle" size="sm" />
                          {createSkuDone}
                        </Badge>
                      </span>
                    ) : null}
                    <Button
                      type="submit"
                      variant="gold"
                      busy={createSkuBusy}
                      disabled={
                        !skuSlug.trim() ||
                        !skuNameAr.trim() ||
                        !skuNameEn.trim() ||
                        !skuGrade.trim() ||
                        !skuProductTypeAr.trim() ||
                        !skuProductTypeEn.trim()
                      }
                    >
                      {t(locale, "admin.createSku")}
                    </Button>
                  </Stack>
                </form>
              </Card>
            </Stack>

            <Stack gap="md">
              <h2 className="ps-section-head__title">{t(locale, "admin.createPackSizeSection")}</h2>
              <Card>
                <form onSubmit={createPackSize}>
                  <Stack gap="md">
                    <Select
                      label={t(locale, "admin.packSizeSku")}
                      placeholder={t(locale, "admin.packSizeSku")}
                      value={packSkuId}
                      onChange={(e) => setPackSkuId(e.target.value)}
                      options={skuOptions}
                    />
                    <TextField
                      label={t(locale, "admin.sizeLabel")}
                      hint={t(locale, "admin.sizeLabelHint")}
                      required
                      value={packSizeLabel}
                      onChange={(e) => setPackSizeLabel(e.target.value)}
                    />
                    <TextField
                      label={t(locale, "admin.sizeLiters")}
                      required
                      forceLtr
                      inputMode="decimal"
                      value={packSizeLiters}
                      onChange={(e) => setPackSizeLiters(e.target.value)}
                    />
                    {createPackError ? <Banner tone="danger">{createPackError}</Banner> : null}
                    {createPackDone ? (
                      <span role="status">
                        <Badge variant="success">
                          <Icon name="check-circle" size="sm" />
                          {createPackDone}
                        </Badge>
                      </span>
                    ) : null}
                    <Button
                      type="submit"
                      variant="gold"
                      busy={createPackBusy}
                      disabled={!packSkuId || !packSizeLabel.trim() || !(Number(packSizeLiters) > 0)}
                    >
                      {t(locale, "admin.createPackSize")}
                    </Button>
                  </Stack>
                </form>
              </Card>
            </Stack>
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
