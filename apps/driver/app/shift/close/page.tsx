"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ReconcileResponse, ShiftResponse } from "@petrospecial/contracts";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Cluster,
  Container,
  DataList,
  DataTable,
  Ltr,
  Money,
  Page,
  QtyStepper,
  Section,
  SectionHead,
  Select,
  Skeleton,
  Stack,
  StatCard
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../../lib/authClient";

interface ProductCard {
  slug: string;
  nameAr: string;
  nameEn: string;
}
interface PackSize {
  packSizeId: string;
  sizeLabel: string;
}
interface CountLine {
  packSizeId: string;
  label: string;
  qty: number;
}

type Step = "reconcile" | "blocked" | "remit" | "close" | "done";

// SCR-DL07-004 (built this session — EP-DL-004/005/006 previously had no UI
// caller anywhere, so a real driver could not end a shift through any
// screen). Same count-then-reveal pattern as /audits/[id]: the physical
// count happens before any expected/variance figure is shown. Unlike the
// audit screen, a non-zero variance here has no self-service resolution
// (0047's own migration comment documents this as a deliberate scoped
// simplification — no acknowledge mechanism exists yet), so this screen
// says so plainly rather than offering a retry that cannot succeed.
export default function CloseShiftPage() {
  const locale = useLocale();
  const [shift, setShift] = useState<ShiftResponse | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const [products, setProducts] = useState<ProductCard[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [packSizes, setPackSizes] = useState<PackSize[]>([]);
  const [selectedPackSize, setSelectedPackSize] = useState("");
  const [qty, setQty] = useState(0);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [variance, setVariance] = useState<ReconcileResponse["variance"]>([]);
  const [busy, setBusy] = useState(false);
  const [remitted, setRemitted] = useState<{ remitted: number; amount: string } | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<ShiftResponse>("/api/v1/driver/shift")
      .then((res) => {
        setShift(res);
        // A reload while already blocked on a variance must still show the
        // blocked state — the server, not this component's own local state,
        // is the source of truth for whether the shift is actually stuck.
        if (res?.closingVariance) setVariance(res.closingVariance);
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

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
    if (!selectedPackSize) return;
    const label = packSizes.find((size) => size.packSizeId === selectedPackSize)?.sizeLabel ?? selectedPackSize;
    setLines((prev) => {
      const existing = prev.find((line) => line.packSizeId === selectedPackSize);
      if (existing) return prev.map((line) => (line.packSizeId === selectedPackSize ? { ...line, qty } : line));
      return [...prev, { packSizeId: selectedPackSize, label, qty }];
    });
  }

  async function submitReconcile() {
    if (!shift) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authedFetch<ReconcileResponse>(`/api/v1/driver/shifts/${shift.shiftId}/reconcile`, {
        method: "POST",
        body: JSON.stringify({ counted: lines.map((line) => ({ packSizeId: line.packSizeId, qty: line.qty })) })
      });
      setVariance(result.variance);
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  async function submitRemit() {
    if (!shift) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authedFetch<{ remitted: number; amount: string }>(
        `/api/v1/driver/shifts/${shift.shiftId}/remit-custody`,
        { method: "POST" }
      );
      setRemitted(result);
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  async function submitClose() {
    if (!shift) return;
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/api/v1/driver/shifts/${shift.shiftId}/close`, { method: "POST" });
      setShift((prev) => (prev ? { ...prev, status: "closed" } : prev));
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  let step: Step = "reconcile";
  if (shift?.status === "closed") step = "done";
  else if (shift?.status === "reconciling") {
    step = variance.length > 0 ? "blocked" : shift.custodyHeld !== "0.00" && !remitted ? "remit" : "close";
  }

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="close-shift-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="close-shift-title" title={t(locale, "driver.closeShiftTitle")} />

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

            {shift === null ? (
              <Banner tone="info" title={t(locale, "driver.noShift")}>
                {t(locale, "driver.noShiftHint")}
              </Banner>
            ) : null}

            {shift && step === "reconcile" ? (
              <Stack gap="lg">
                <Banner tone="info">{t(locale, "driver.reconcileHint")}</Banner>

                <Card>
                  <Stack gap="md">
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
                      label={t(locale, "driver.counted")}
                      value={qty}
                      min={0}
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
                  <h2 className="ps-section-head__title">{t(locale, "driver.closingCount")}</h2>
                  <DataList
                    label={t(locale, "driver.closingCount")}
                    state={lines.length === 0 ? "empty" : "ready"}
                    emptyTitle={t(locale, "driver.loadEmpty")}
                    items={lines.map((line) => ({
                      id: line.packSizeId,
                      title: <Ltr>{line.label}</Ltr>,
                      fields: [{ label: t(locale, "driver.counted"), value: <Ltr>{count(line.qty)}</Ltr> }],
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

                <Button variant="gold" size="lg" busy={busy} disabled={lines.length === 0} onClick={submitReconcile}>
                  {t(locale, "driver.reconcileSubmit")}
                </Button>

                <ButtonLink linkAs={Link} href="/shift" variant="ghost">
                  {t(locale, "common.back")}
                </ButtonLink>
              </Stack>
            ) : null}

            {shift && step === "blocked" ? (
              <Stack gap="lg">
                <Banner tone="danger" title={t(locale, "driver.varianceBlockedTitle")}>
                  {t(locale, "driver.varianceBlocked")}
                </Banner>

                <DataTable
                  caption={t(locale, "driver.variance")}
                  state="ready"
                  rows={variance}
                  getRowKey={(row) => row.packSizeId}
                  columns={[
                    {
                      key: "packSize",
                      header: t(locale, "catalog.packSize"),
                      emphasis: "primary",
                      render: (row) => <Ltr>{row.packSizeId}</Ltr>
                    },
                    {
                      key: "expected",
                      header: t(locale, "driver.expected"),
                      align: "end",
                      render: (row) => <Ltr>{count(row.expected)}</Ltr>
                    },
                    {
                      key: "counted",
                      header: t(locale, "driver.counted"),
                      align: "end",
                      render: (row) => <Ltr>{count(row.counted)}</Ltr>
                    },
                    {
                      key: "delta",
                      header: t(locale, "driver.variance"),
                      align: "end",
                      render: (row) => (
                        <Ltr>
                          {row.delta > 0 ? "+" : ""}
                          {count(row.delta)}
                        </Ltr>
                      )
                    }
                  ]}
                />

                <ButtonLink linkAs={Link} href="/van" variant="gold">
                  {t(locale, "driver.vanTitle")}
                </ButtonLink>
              </Stack>
            ) : null}

            {shift && (step === "remit" || step === "close") ? (
              <Stack gap="lg">
                <Banner tone="success">{t(locale, "driver.auditSubmitted")}</Banner>

                <StatCard
                  label={t(locale, "driver.custodyHeld")}
                  value={<Money amount={remitted ? "0.00" : shift.custodyHeld} locale={locale} emphasis="strong" />}
                  caption={t(locale, "supplier.custodyNotDebt")}
                  icon="banknote"
                />

                {step === "remit" ? (
                  <Button variant="gold" size="lg" busy={busy} onClick={submitRemit}>
                    {t(locale, "driver.remitCustody")}
                  </Button>
                ) : (
                  <Stack gap="md">
                    {remitted ? <Banner tone="success">{t(locale, "driver.remitCustodySuccess")}</Banner> : null}
                    <Button variant="gold" size="lg" busy={busy} onClick={submitClose}>
                      {t(locale, "driver.confirmCloseShift")}
                    </Button>
                  </Stack>
                )}
              </Stack>
            ) : null}

            {shift && step === "done" ? (
              <Stack gap="lg">
                <Banner tone="success">{t(locale, "driver.shiftClosedTitle")}</Banner>
                <ButtonLink linkAs={Link} href="/shift" variant="gold">
                  {t(locale, "driver.backToShift")}
                </ButtonLink>
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
