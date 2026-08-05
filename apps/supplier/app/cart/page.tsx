"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Container,
  EmptyState,
  IconWell,
  LineItem,
  LineList,
  LineNote,
  Money,
  Page,
  QtyStepper,
  RadioGroup,
  Rail,
  Section,
  SectionHead,
  Select,
  Skeleton,
  Stack,
  SummaryPanel
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { isApiError, messageFor, statusLabel, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";

interface CartLine {
  packSizeId: string;
  skuSlug: string;
  nameAr: string;
  nameEn: string;
  qty: number;
  tierUnitPrice: string;
}
interface CartResponse {
  lines: CartLine[];
  subtotal: string;
  vatAmount: string;
  total: string;
}
interface AddressItem {
  id: string;
  recipientName: string;
  line1: string;
}
interface CreditFigures {
  debt: { exposure: string; creditLimit: string; headroom: string };
}

const CREDIT_EXCEEDED = "CREDIT_LIMIT_EXCEEDED";
const NO_CREDIT_LIMIT = "NO_CREDIT_LIMIT";

// SCR-SP01-002 — the wholesale cart and its checkout are one screen
// (EP-SP-002 cart mutation + EP-SP-003 placement).
//
// Was 14 inline styles, literal #ddd borders, a bare number input per line and
// bare numbers for every amount — not one currency symbol on the screen.
//
// The two rules it exists to carry:
//
//  * D-11 / D-14 (e): the online-payment rail is dormant and stays dormant. It
//    appears once, disabled, reading "Coming Soon · قريباً", and there is no
//    code path here that could enable it.
//  * CREDIT_LIMIT_EXCEEDED is a block with figures on it, not a red sentence.
//    Exposure, limit and headroom all come from EP-SP-052 as the server's own
//    strings — this file computes no money (NFR-SP-005) — and the way out is
//    spelled out: settle an invoice, or place the order by bank transfer.
export default function CartPage() {
  const locale = useLocale();
  const router = useRouter();
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [credit, setCredit] = useState<CreditFigures | null>(null);
  const [addresses, setAddresses] = useState<AddressItem[]>([]);
  const [addressId, setAddressId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("credit_terms");
  const [error, setError] = useState<string | null>(null);
  const [creditBlocked, setCreditBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lineBusy, setLineBusy] = useState<string | null>(null);

  // One key for this cart, not one per click. `supplier-<address>-<Date.now()>`,
  // which is what this used to send, makes every retry a brand-new request and
  // defeats the header it is written into.
  const [idempotencyKey] = useState(() => `supplier-cart-${Math.random().toString(36).slice(2)}`);

  const refresh = useCallback(async () => {
    try {
      setCart(await authedFetch<CartResponse>("/api/v1/supplier/cart"));
      setError(null);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    }
  }, [locale]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    refresh();
    authedFetch<{ items: AddressItem[] }>("/api/v1/me/addresses")
      .then((res) => {
        setAddresses(res.items);
        if (res.items[0]) setAddressId(res.items[0].id);
      })
      .catch(() => setAddresses([]));
    // The credit figures are read up front so that the block, if it comes,
    // can be drawn with real numbers rather than with an apology.
    authedFetch<CreditFigures>("/api/v1/supplier/dashboard")
      .then(setCredit)
      .catch(() => setCredit(null));
  }, [refresh, router]);

  async function updateQty(packSizeId: string, qty: number) {
    setLineBusy(packSizeId);
    try {
      await authedFetch("/api/v1/supplier/cart", { method: "PATCH", body: JSON.stringify({ packSizeId, qty }) });
      await refresh();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setLineBusy(null);
    }
  }

  async function removeLine(packSizeId: string) {
    setLineBusy(packSizeId);
    try {
      await authedFetch(`/api/v1/supplier/cart?packSizeId=${packSizeId}`, { method: "DELETE" });
      await refresh();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setLineBusy(null);
    }
  }

  async function placeOrder() {
    if (!cart || !addressId) return;
    setBusy(true);
    setError(null);
    setCreditBlocked(false);
    try {
      const res = await authedFetch<{ orderId: string }>("/api/v1/supplier/orders", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          lines: cart.lines.map((line) => ({ packSizeId: line.packSizeId, qty: line.qty })),
          paymentMethod,
          addressId
        })
      });
      router.push(`/orders/${res.orderId}`);
    } catch (thrown) {
      if (isApiError(thrown, CREDIT_EXCEEDED) || isApiError(thrown, NO_CREDIT_LIMIT)) setCreditBlocked(true);
      else setError(messageFor(locale, thrown));
      setBusy(false);
    }
  }

  const lines = cart?.lines ?? [];

  const summaryRows = useMemo(() => {
    if (!cart) return [];
    return [
      { id: "subtotal", label: t(locale, "cart.subtotal"), value: <Money amount={cart.subtotal} locale={locale} /> },
      {
        id: "vat",
        // Wholesale is quoted ex-VAT with VAT itemised as its own line, per
        // ZATCA — the opposite of the retail storefront, where the shelf
        // price already includes it.
        label: t(locale, "cart.vat"),
        value: <Money amount={cart.vatAmount} locale={locale} />,
        emphasis: "muted" as const
      },
      {
        id: "total",
        label: t(locale, "cart.total"),
        value: <Money amount={cart.total} locale={locale} emphasis="strong" />,
        emphasis: "total" as const
      }
    ];
  }, [cart, locale]);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="cart-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="cart-title" title={t(locale, "cart.title")} />

            {error ? (
              <Banner
                tone="danger"
                action={
                  <Button variant="ghost" size="sm" onClick={refresh}>
                    {t(locale, "common.retry")}
                  </Button>
                }
              >
                {error}
              </Banner>
            ) : null}

            {!cart && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="md">
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="lg" />
                </Stack>
              </div>
            ) : null}

            {cart && lines.length === 0 ? (
              <EmptyState
                illustration={<IconWell name="cart" tone="gold" />}
                title={t(locale, "cart.empty")}
                description={t(locale, "supplier.tierNote")}
                action={
                  <ButtonLink linkAs={Link} href="/catalog" variant="gold">
                    {t(locale, "nav.catalog")}
                  </ButtonLink>
                }
              />
            ) : null}

            {cart && lines.length > 0 ? (
              <Rail
                placement="end"
                rail={
                  <Stack gap="md">
                    <Card aria-live="polite">
                      <SummaryPanel label={t(locale, "cart.summary")} rows={summaryRows}>
                        <LineNote tone="muted">{t(locale, "supplier.tierNote")}</LineNote>
                      </SummaryPanel>
                    </Card>

                    <Card>
                      <Stack gap="md">
                        <Select
                          label={t(locale, "checkout.chooseAddress")}
                          value={addressId}
                          onChange={(event) => setAddressId(event.target.value)}
                          options={addresses.map((address) => ({
                            value: address.id,
                            label: `${address.recipientName} — ${address.line1}`
                          }))}
                        />

                        <RadioGroup
                          label={t(locale, "checkout.paymentMethod")}
                          name="payment"
                          value={paymentMethod}
                          onChange={setPaymentMethod}
                          options={[
                            {
                              value: "credit_terms",
                              label: statusLabel("payment", locale, "credit_terms"),
                              description: t(locale, "supplier.creditLimit")
                            },
                            { value: "bank_transfer", label: statusLabel("payment", locale, "bank_transfer") },
                            // D-11: dormant, visible, disabled, labelled.
                            // Nothing on this screen can activate it.
                            {
                              value: "online",
                              label: t(locale, "supplier.onlinePayment"),
                              disabled: true,
                              trailing: t(locale, "common.comingSoon")
                            }
                          ]}
                        />

                        {creditBlocked ? (
                          <Banner tone="warn" title={t(locale, "supplier.creditBlockTitle")}>
                            <Stack gap="sm">
                              <span>
                                {credit
                                  ? t(locale, "supplier.creditBlocked", {
                                      amount: cart.total,
                                      headroom: credit.debt.headroom
                                    })
                                  : t(locale, "error.credit_limit_exceeded")}
                              </span>
                              {credit ? (
                                <SummaryPanel
                                  label={t(locale, "supplier.debtPanel")}
                                  rows={[
                                    {
                                      id: "limit",
                                      label: t(locale, "supplier.creditLimit"),
                                      value: <Money amount={credit.debt.creditLimit} locale={locale} />
                                    },
                                    {
                                      id: "exposure",
                                      label: t(locale, "supplier.exposure"),
                                      value: <Money amount={credit.debt.exposure} locale={locale} />
                                    },
                                    {
                                      id: "headroom",
                                      label: t(locale, "supplier.headroom"),
                                      value: <Money amount={credit.debt.headroom} locale={locale} emphasis="strong" />
                                    },
                                    {
                                      id: "order",
                                      label: t(locale, "cart.total"),
                                      value: <Money amount={cart.total} locale={locale} />,
                                      emphasis: "total" as const
                                    }
                                  ]}
                                />
                              ) : null}
                              <span>{t(locale, "supplier.creditBlockHint")}</span>
                            </Stack>
                          </Banner>
                        ) : null}

                        <Button variant="gold" busy={busy} disabled={!addressId} onClick={placeOrder}>
                          {busy ? t(locale, "checkout.placingOrder") : t(locale, "checkout.placeOrder")}
                        </Button>
                      </Stack>
                    </Card>
                  </Stack>
                }
              >
                <LineList label={t(locale, "cart.itemsLabel")}>
                  {lines.map((line) => {
                    const name = locale === "ar" ? line.nameAr : line.nameEn;
                    return (
                      <LineItem
                        key={line.packSizeId}
                        title={name}
                        meta={
                          <>
                            {t(locale, "cart.unitPrice")}: <Money amount={line.tierUnitPrice} locale={locale} />{" "}
                            {t(locale, "supplier.exVat")}
                          </>
                        }
                        control={
                          <QtyStepper
                            label={t(locale, "cart.qtyFor", { name })}
                            value={line.qty}
                            min={1}
                            max={99}
                            disabled={lineBusy === line.packSizeId}
                            increaseLabel={t(locale, "cart.increase")}
                            decreaseLabel={t(locale, "cart.decrease")}
                            onChange={(qty) => updateQty(line.packSizeId, qty)}
                          />
                        }
                        price={<Money amount={line.tierUnitPrice} locale={locale} emphasis="strong" />}
                        action={
                          <Button
                            variant="ghost"
                            size="sm"
                            busy={lineBusy === line.packSizeId}
                            aria-label={t(locale, "cart.removeLine", { name })}
                            onClick={() => removeLine(line.packSizeId)}
                          >
                            {t(locale, "common.remove")}
                          </Button>
                        }
                      />
                    );
                  })}
                </LineList>
              </Rail>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
