"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ShiftResponse } from "@petrospecial/contracts";
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  Card,
  Cluster,
  Container,
  DataList,
  EmptyState,
  IconWell,
  Ltr,
  Money,
  Page,
  QtyStepper,
  Section,
  SectionHead,
  Select,
  Skeleton,
  Stack,
  StatCard,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t, type Locale } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";

interface ProductCard {
  slug: string;
  nameAr: string;
  nameEn: string;
}
interface PackSize {
  packSizeId: string;
  sizeLabel: string;
}
interface LoadLine {
  packSizeId: string;
  label: string;
  qty: number;
}

/** SCR-DL07-001 — the van load-out. Product → pack size → quantity, with a
 * running list, because a driver loading a van is adding one line at a time
 * and needs to see what is already on it. */
function LoadOutForm({ locale, onStarted }: { locale: Locale; onStarted: (shift: ShiftResponse) => void }) {
  const [vanId, setVanId] = useState("");
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [packSizes, setPackSizes] = useState<PackSize[]>([]);
  const [selectedPackSize, setSelectedPackSize] = useState("");
  const [qty, setQty] = useState(1);
  const [lines, setLines] = useState<LoadLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authedFetch<{ items: ProductCard[] }>("/api/v1/catalog/products?limit=100")
      .then((res) => setProducts(res.items))
      .catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    if (!selectedSlug) {
      setPackSizes([]);
      return;
    }
    authedFetch<{ items: PackSize[] }>(`/api/v1/catalog/products/${selectedSlug}/pack-sizes`)
      .then((res) => {
        setPackSizes(res.items);
        setSelectedPackSize(res.items[0]?.packSizeId ?? "");
      })
      .catch(() => setPackSizes([]));
  }, [selectedSlug]);

  function addLine() {
    if (!selectedPackSize || qty < 1) return;
    const label = packSizes.find((size) => size.packSizeId === selectedPackSize)?.sizeLabel ?? selectedPackSize;
    setLines((prev) => {
      const existing = prev.find((line) => line.packSizeId === selectedPackSize);
      if (existing) {
        return prev.map((line) =>
          line.packSizeId === selectedPackSize ? { ...line, qty: line.qty + qty } : line
        );
      }
      return [...prev, { packSizeId: selectedPackSize, label, qty }];
    });
  }

  async function startShift() {
    setBusy(true);
    setError(null);
    try {
      const shift = await authedFetch<{ shiftId: string }>("/api/v1/driver/shifts/start", {
        method: "POST",
        body: JSON.stringify({ vanId, load: lines.map((line) => ({ packSizeId: line.packSizeId, qty: line.qty })) })
      });
      onStarted({
        shiftId: shift.shiftId,
        vanId,
        status: "open",
        available: true,
        vanStock: lines.map((line) => ({ packSizeId: line.packSizeId, qty: line.qty })),
        custodyHeld: "0.00"
      });
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="lg">
      <EmptyState
        illustration={<IconWell name="truck" tone="gold" />}
        title={t(locale, "driver.noShift")}
        description={t(locale, "driver.noShiftHint")}
      />

      <Card>
        <Stack gap="md">
          <TextField
            label={t(locale, "driver.vanId")}
            required
            forceLtr
            value={vanId}
            onChange={(event) => setVanId(event.target.value)}
          />

          <Select
            label={t(locale, "nav.catalog")}
            value={selectedSlug}
            placeholder={t(locale, "form.selectPlaceholder")}
            onChange={(event) => setSelectedSlug(event.target.value)}
            options={products.map((product) => ({
              value: product.slug,
              label: locale === "ar" ? product.nameAr : product.nameEn
            }))}
          />

          <Select
            label={t(locale, "catalog.packSize")}
            value={selectedPackSize}
            disabled={packSizes.length === 0}
            onChange={(event) => setSelectedPackSize(event.target.value)}
            options={packSizes.map((size) => ({ value: size.packSizeId, label: size.sizeLabel }))}
          />

          <QtyStepper
            label={t(locale, "form.quantity")}
            value={qty}
            min={1}
            max={999}
            increaseLabel={t(locale, "cart.increase")}
            decreaseLabel={t(locale, "cart.decrease")}
            onChange={setQty}
          />

          <Cluster gap="sm">
            <Button variant="ghost" disabled={!selectedPackSize} onClick={addLine}>
              {t(locale, "driver.addLine")}
            </Button>
          </Cluster>
        </Stack>
      </Card>

      <Stack gap="md">
        <h2 className="ps-section-head__title">{t(locale, "driver.loadLines")}</h2>
        <DataList
          label={t(locale, "driver.loadLines")}
          state={lines.length === 0 ? "empty" : "ready"}
          emptyTitle={t(locale, "driver.loadEmpty")}
          items={lines.map((line) => ({
            id: line.packSizeId,
            title: <Ltr>{line.label}</Ltr>,
            fields: [{ label: t(locale, "form.quantity"), value: <Ltr>{count(line.qty)}</Ltr> }],
            actions: (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLines((prev) => prev.filter((entry) => entry.packSizeId !== line.packSizeId))}
              >
                {t(locale, "common.remove")}
              </Button>
            )
          }))}
        />
      </Stack>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Button variant="gold" size="lg" busy={busy} disabled={!vanId || lines.length === 0} onClick={startShift}>
        {t(locale, "driver.startShift")}
      </Button>
    </Stack>
  );
}

// SCR-DL07-001 and SCR-DL07-002 — EP-DL-001/002.
//
// Was 180 lines of unstyled markup with hardcoded English inside a page whose
// other strings were translated: "Van ID (UUID)", "Add load line", "Select
// product…", "Starting…", "Van ID and at least one load line are required."
export default function ShiftPage() {
  const locale = useLocale();
  const [shift, setShift] = useState<ShiftResponse | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    authedFetch<ShiftResponse>("/api/v1/driver/shift")
      .then(setShift)
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  async function toggleAvailability() {
    if (!shift) return;
    setAvailabilityBusy(true);
    try {
      await authedFetch("/api/v1/driver/availability", {
        method: "PATCH",
        body: JSON.stringify({ available: !shift.available })
      });
      setShift((prev) => (prev ? { ...prev, available: !prev.available } : prev));
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setAvailabilityBusy(false);
    }
  }

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="shift-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="shift-title" title={t(locale, "nav.shift")} />

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

            {shift === undefined && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="md">
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="lg" />
                </Stack>
              </div>
            ) : null}

            {shift === null ? <LoadOutForm locale={locale} onStarted={setShift} /> : null}

            {shift ? (
              <Stack gap="lg">
                <Cluster gap="md" align="center">
                  <Badge variant={shift.available ? "success" : "neutral"}>
                    {t(locale, shift.available ? "driver.availableForTasks" : "driver.unavailableForTasks")}
                  </Badge>
                  <Button variant="ghost" size="sm" busy={availabilityBusy} onClick={toggleAvailability}>
                    {t(locale, "driver.toggleAvailability")}
                  </Button>
                </Cluster>

                <Cluster gap="md">
                  <StatCard
                    label={t(locale, "driver.vanPlate")}
                    value={<Ltr>{shift.vanId}</Ltr>}
                    caption={t(locale, "driver.shiftOpen")}
                    icon="truck"
                    tone="gold"
                  />
                  {/* Cash held is custody, and it is labelled as custody
                      everywhere it appears — including here, where a driver
                      might otherwise read it as takings. */}
                  <StatCard
                    label={t(locale, "supplier.custodyPanel")}
                    value={<Money amount={shift.custodyHeld} locale={locale} emphasis="strong" />}
                    caption={t(locale, "supplier.custodyNotDebt")}
                    icon="banknote"
                  />
                </Cluster>

                <Stack gap="md">
                  <h2 className="ps-section-head__title">{t(locale, "driver.openingStock")}</h2>
                  <DataList
                    label={t(locale, "driver.openingStock")}
                    state={shift.vanStock.length === 0 ? "empty" : "ready"}
                    emptyTitle={t(locale, "driver.loadEmpty")}
                    items={shift.vanStock.map((line) => ({
                      id: line.packSizeId,
                      title: <Ltr>{line.packSizeId}</Ltr>,
                      fields: [{ label: t(locale, "form.quantity"), value: <Ltr>{count(line.qty)}</Ltr> }]
                    }))}
                  />
                </Stack>

                {/* Closing a shift needs a nil variance and remitted custody
                    (AUDIT_VARIANCE / CUSTODY_OPEN). Both are enforced
                    server-side; both are stated here so a driver learns the
                    rule before they are stopped by it. */}
                <Banner tone="info">{t(locale, "driver.endShiftBlocked")}</Banner>

                <Cluster gap="sm">
                  <ButtonLink linkAs={Link} href="/manifest" variant="gold" size="lg">
                    {t(locale, "driver.manifestTitle")}
                  </ButtonLink>
                  <ButtonLink linkAs={Link} href="/audits" variant="ghost">
                    {t(locale, "driver.audits")}
                  </ButtonLink>
                  <ButtonLink linkAs={Link} href="/shift/close" variant="dark">
                    {t(locale, "driver.endShift")}
                  </ButtonLink>
                </Cluster>
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
