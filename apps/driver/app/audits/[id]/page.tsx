"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { AuditCountResponse } from "@petrospecial/contracts";
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
  Page,
  QtyStepper,
  Section,
  SectionHead,
  Select,
  Stack
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

// SCR-DL06-001, the count itself — EP-DL-071.
//
// The rule that shapes the whole screen: **expected quantities stay hidden
// until the count is submitted.** delivery.close_audit computes the delta
// server-side and the driver only learns it from the result. Showing the
// expected number first turns a stock count into a matching exercise, which
// is exactly what a zero-tolerance audit is meant to prevent — so the screen
// says so out loud rather than leaving the absence to be noticed.
export default function AuditCountPage() {
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [packSizes, setPackSizes] = useState<PackSize[]>([]);
  const [selectedPackSize, setSelectedPackSize] = useState("");
  const [qty, setQty] = useState(0);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [result, setResult] = useState<AuditCountResponse | null>(null);
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
    if (!selectedPackSize) return;
    const label = packSizes.find((size) => size.packSizeId === selectedPackSize)?.sizeLabel ?? selectedPackSize;
    setLines((prev) => {
      const existing = prev.find((line) => line.packSizeId === selectedPackSize);
      // A recount replaces the number rather than adding to it — this is a
      // count of what is in the van, not a running tally of what was loaded.
      if (existing) return prev.map((line) => (line.packSizeId === selectedPackSize ? { ...line, qty } : line));
      return [...prev, { packSizeId: selectedPackSize, label, qty }];
    });
  }

  async function submitCount() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await authedFetch<AuditCountResponse>(`/api/v1/driver/audits/${params.id}/count`, {
          method: "POST",
          body: JSON.stringify({ counted: lines.map((line) => ({ packSizeId: line.packSizeId, qty: line.qty })) })
        })
      );
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  // ---- After submission: the expected figures, and the variance ---------
  if (result) {
    return (
      <Page width="flush">
        <Section air="app" aria-labelledby="audit-result">
          <Container>
            <Stack gap="lg">
              <SectionHead level={1} titleId="audit-result" title={t(locale, "driver.auditSubmitted")} />

              {result.variance.length === 0 ? (
                <Banner tone="success">{t(locale, "driver.auditSubmitted")}</Banner>
              ) : (
                <Banner tone="warn" title={t(locale, "driver.variance")}>
                  {t(locale, "driver.auditVariance")}
                </Banner>
              )}

              <DataTable
                caption={t(locale, "driver.variance")}
                state={result.variance.length === 0 ? "empty" : "ready"}
                emptyTitle={t(locale, "driver.auditSubmitted")}
                rows={result.variance}
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

              <ButtonLink linkAs={Link} href="/audits" variant="gold">
                {t(locale, "driver.audits")}
              </ButtonLink>
            </Stack>
          </Container>
        </Section>
      </Page>
    );
  }

  // ---- Before submission: no expected figures anywhere ------------------
  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="audit-count">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="audit-count" title={t(locale, "driver.countAudit")} />

            <Banner tone="info">{t(locale, "driver.expectedHiddenHint")}</Banner>

            {error ? <Banner tone="danger">{error}</Banner> : null}

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

            <Button variant="gold" size="lg" busy={busy} disabled={lines.length === 0} onClick={submitCount}>
              {t(locale, "driver.submitCount")}
            </Button>

            <ButtonLink linkAs={Link} href="/audits" variant="ghost">
              {t(locale, "common.back")}
            </ButtonLink>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
