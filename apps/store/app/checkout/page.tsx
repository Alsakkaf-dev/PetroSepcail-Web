"use client";

import type { AddressRow, CartResponse, CheckoutQuoteResponse, PlaceOrderResponse } from "@petrospecial/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Cluster,
  Container,
  EmptyState,
  IconWell,
  LineItem,
  LineList,
  LineNote,
  Money,
  Page,
  RadioGroup,
  RangeSlider,
  Rail,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  Stepper,
  SummaryPanel,
  TextField
} from "@petrospecial/ui";
import type { RangeSliderProps } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import {
  count,
  isApiError,
  messageFor,
  money,
  points as formatPoints,
  statusLabel,
  t,
  type StringKey
} from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";

interface PointsBalanceResponse {
  balance: number;
}
interface RedemptionQuoteResponse {
  allowedPoints: number;
  discountSar: string;
}

const STEPS = ["address", "slot", "payment", "review"] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLE: Record<Step, StringKey> = {
  address: "checkout.stepAddress",
  slot: "checkout.stepDelivery",
  payment: "checkout.stepPayment",
  review: "checkout.stepReview"
};

// The API returns each slot's own `label`, but that label is not localised —
// the storefront has always drawn these three from its own dictionary, and now
// draws them from the platform's.
const SLOT_LABEL: Record<string, StringKey> = {
  same_day: "checkout.slotSameDay",
  next_am: "checkout.slotNextAm",
  next_pm: "checkout.slotNextPm"
};

const OUT_OF_RADIUS = "OUT_OF_DELIVERY_RADIUS";

const EMPTY_ADDRESS = { recipientName: "", phone: "", line1: "", city: "", lat: "", lng: "" };

// SCR-SF04-001, hosting SCR-LE07-001 (redeem at checkout).
//
// Was one long scroll of eleven ungrouped sections, 18 inline styles, 13
// useState hooks and the literal string "failed" shown to a customer whose
// order had just not been placed.
//
// The rules this screen carries:
//
//  * Exactly two payment methods exist today — cash on delivery and bank
//    transfer. There is no card control, enabled or otherwise (D-11: never
//    activate a payment provider). "Online payment" appears once, disabled,
//    labelled "coming soon", so the absence is explained rather than felt.
//  * Out of radius is a block, not a warning: the address step will not hand
//    over until the server has quoted a deliverable address.
//  * Points redemption is bounded by the server's own EP-X-003 quote. The
//    slider physically cannot exceed it, the cap is written out in words
//    above the control, and the chosen amount is announced rather than left
//    as a bare number on a track.
export default function CheckoutPage() {
  const locale = useLocale();
  const router = useRouter();

  const [step, setStep] = useState<Step>("address");
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [addresses, setAddresses] = useState<AddressRow[] | null>(null);
  const [addressId, setAddressId] = useState("");
  const [newAddress, setNewAddress] = useState(EMPTY_ADDRESS);
  const [addingAddress, setAddingAddress] = useState(false);
  const [quote, setQuote] = useState<CheckoutQuoteResponse | null>(null);
  const [radiusBlocked, setRadiusBlocked] = useState(false);
  const [slot, setSlot] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cod");
  const [balance, setBalance] = useState(0);
  const [requestedPoints, setRequestedPoints] = useState(0);
  const [cap, setCap] = useState<RedemptionQuoteResponse | null>(null);
  const [redemption, setRedemption] = useState<RedemptionQuoteResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<CartResponse>("/api/v1/cart")
      .then(setCart)
      .catch((thrown) => setError(messageFor(locale, thrown)));
    authedFetch<{ items: AddressRow[] }>("/api/v1/me/addresses")
      .then((res) => {
        setAddresses(res.items);
        const preferred = res.items.find((a) => a.isDefault) ?? res.items[0];
        if (preferred) setAddressId(preferred.id);
        else setAddingAddress(true);
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
    authedFetch<PointsBalanceResponse>("/api/v1/loyalty/points/balance")
      .then((res) => setBalance(res.balance))
      // A loyalty balance that will not load must not stop someone paying.
      .catch(() => setBalance(0));
  }, [locale]);

  useEffect(load, [load]);

  const orderTotal = cart ? Number(cart.totals.total) : 0;

  // The ceiling, quoted once: min(balance, 50% of this order), decided by
  // loyalty.quote_redemption and never by this file (NFR-LE-003).
  useEffect(() => {
    if (balance <= 0 || orderTotal <= 0) return;
    let live = true;
    authedFetch<RedemptionQuoteResponse>("/api/v1/loyalty/redemption/quote", {
      method: "POST",
      body: JSON.stringify({ pointsRequested: balance, orderTotal })
    })
      .then((res) => {
        if (live) setCap(res);
      })
      .catch(() => {
        if (live) setCap(null);
      });
    return () => {
      live = false;
    };
  }, [balance, orderTotal]);

  // What the customer actually chose, re-quoted. Debounced, because the
  // slider fires while it is being dragged and each of those is a round trip.
  useEffect(() => {
    if (requestedPoints <= 0 || orderTotal <= 0) {
      setRedemption(null);
      return;
    }
    const timer = setTimeout(() => {
      authedFetch<RedemptionQuoteResponse>("/api/v1/loyalty/redemption/quote", {
        method: "POST",
        body: JSON.stringify({ pointsRequested: requestedPoints, orderTotal })
      })
        .then(setRedemption)
        .catch(() => setRedemption(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [requestedPoints, orderTotal]);

  async function saveAddress(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await authedFetch<AddressRow>("/api/v1/me/addresses", {
        method: "POST",
        body: JSON.stringify({
          recipientName: newAddress.recipientName,
          phone: newAddress.phone,
          line1: newAddress.line1,
          city: newAddress.city,
          lat: newAddress.lat ? Number(newAddress.lat) : null,
          lng: newAddress.lng ? Number(newAddress.lng) : null,
          isDefault: true
        })
      });
      setAddresses((prev) => [...(prev ?? []), created]);
      setAddressId(created.id);
      setNewAddress(EMPTY_ADDRESS);
      setAddingAddress(false);
      setRadiusBlocked(false);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  // EP-SF-020. The only way out of the address step: the server has to agree
  // this address is deliverable before a slot is worth choosing.
  async function confirmAddress() {
    if (!addressId) return;
    setBusy(true);
    setError(null);
    setRadiusBlocked(false);
    try {
      const res = await authedFetch<CheckoutQuoteResponse>("/api/v1/checkout/quote", {
        method: "POST",
        body: JSON.stringify({ addressId })
      });
      setQuote(res);
      const first = res.slots.find((s) => !s.cutoffPassed);
      setSlot(first ? first.code : "");
      setStep("slot");
    } catch (thrown) {
      if (isApiError(thrown, OUT_OF_RADIUS)) setRadiusBlocked(true);
      else setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder() {
    if (!cart) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch<PlaceOrderResponse>("/api/v1/orders", {
        method: "POST",
        // One cart converts into at most one order, so the cart's own id is
        // the idempotency scope. A key with a timestamp in it — which is what
        // this used to send — makes every retry a *new* request and defeats
        // the header entirely.
        headers: { "idempotency-key": `store-${cart.cartId}` },
        body: JSON.stringify({
          cartId: cart.cartId,
          addressId,
          slot,
          paymentMethod,
          ...(redemption && redemption.allowedPoints > 0 ? { pointsToRedeem: redemption.allowedPoints } : {})
        })
      });
      router.push(`/orders/${res.orderId}`);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
      setBusy(false);
    }
  }

  const selectedAddress = (addresses ?? []).find((a) => a.id === addressId) ?? null;
  const lines = cart?.lines ?? [];
  const unavailable = lines.some((line) => !line.inStock);
  const stepIndex = STEPS.indexOf(step);

  const summaryRows = useMemo(() => {
    if (!cart) return [];
    return [
      { id: "subtotal", label: t(locale, "cart.subtotal"), value: <Money amount={cart.totals.subtotal} locale={locale} /> },
      {
        id: "vat",
        label: t(locale, "cart.vat"),
        value: <Money amount={cart.totals.vat} locale={locale} />,
        emphasis: "muted" as const
      },
      ...(Number(cart.totals.discount) > 0
        ? [
            {
              id: "discount",
              label: t(locale, "cart.discount"),
              value: <Money amount={`-${cart.totals.discount}`} locale={locale} />,
              emphasis: "credit" as const
            }
          ]
        : []),
      ...(quote
        ? [
            {
              id: "delivery",
              label: t(locale, "checkout.deliveryFee"),
              value: quote.freeDelivery ? (
                <span>{t(locale, "checkout.free")}</span>
              ) : (
                <Money amount={quote.deliveryFee} locale={locale} />
              )
            }
          ]
        : []),
      ...(redemption && redemption.allowedPoints > 0
        ? [
            {
              id: "points",
              label: t(locale, "checkout.pointsApplied"),
              value: <Money amount={`-${redemption.discountSar}`} locale={locale} />,
              emphasis: "credit" as const
            }
          ]
        : []),
      {
        id: "total",
        label: t(locale, "cart.total"),
        value: <Money amount={cart.totals.total} locale={locale} emphasis="strong" />,
        emphasis: "total" as const
      }
    ];
  }, [cart, locale, quote, redemption]);

  const capPoints = cap?.allowedPoints ?? 0;
  const sliderProps: Pick<RangeSliderProps, "hint" | "valueText"> = {
    hint:
      capPoints > 0
        ? t(locale, "loyalty.redeemCap", {
            points: formatPoints(capPoints),
            amount: money(locale, cap?.discountSar ?? "0")
          })
        : undefined,
    valueText: redemption
      ? `${formatPoints(redemption.allowedPoints)} — ${money(locale, redemption.discountSar)}`
      : formatPoints(requestedPoints)
  };

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="checkout-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="checkout-title" title={t(locale, "checkout.title")} />

            {!cart && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="md">
                  <Skeleton variant="block" size="sm" />
                  <Skeleton variant="block" size="lg" />
                </Stack>
              </div>
            ) : null}

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

            {cart && lines.length === 0 ? (
              <EmptyState
                illustration={<IconWell name="cart" tone="gold" />}
                title={t(locale, "checkout.emptyCart")}
                description={t(locale, "cart.emptyHint")}
                action={
                  <ButtonLink linkAs={Link} href="/catalog" variant="gold">
                    {t(locale, "catalog.browse")}
                  </ButtonLink>
                }
              />
            ) : null}

            {cart && lines.length > 0 && unavailable ? (
              <Banner
                tone="warn"
                title={t(locale, "cart.blockedTitle")}
                action={
                  <ButtonLink linkAs={Link} href="/cart" variant="ghost" size="sm">
                    {t(locale, "cart.title")}
                  </ButtonLink>
                }
              >
                {t(locale, "cart.blockedByUnavailable")}
              </Banner>
            ) : null}

            {cart && lines.length > 0 && !unavailable ? (
              <Rail
                placement="end"
                rail={
                  <Card aria-live="polite">
                    <SummaryPanel label={t(locale, "cart.summary")} rows={summaryRows}>
                      <p className="ps-line-note ps-line-note--muted">{t(locale, "cart.vatIncluded")}</p>
                    </SummaryPanel>
                  </Card>
                }
              >
                <Stack gap="lg">
                  <Stepper
                    label={t(locale, "checkout.stepsLabel")}
                    current={stepIndex}
                    status={t(locale, "checkout.stepStatus", { current: count(stepIndex + 1), total: count(STEPS.length) })}
                    stateLabels={{
                      done: t(locale, "checkout.stepDone"),
                      current: t(locale, "checkout.stepCurrent"),
                      upcoming: t(locale, "checkout.stepUpcoming")
                    }}
                    steps={STEPS.map((id) => ({ id, label: t(locale, STEP_TITLE[id]) }))}
                  />

                  {/* ---- 1. Address ------------------------------------ */}
                  {step === "address" ? (
                    <Card>
                      <Stack gap="md">
                        <h2 className="ps-section-head__title">{t(locale, "checkout.chooseAddress")}</h2>

                        {addresses === null ? <Skeleton variant="block" size="md" /> : null}

                        {addresses !== null && addresses.length === 0 && !addingAddress ? (
                          <EmptyState
                            title={t(locale, "checkout.noAddresses")}
                            description={t(locale, "checkout.noAddressesHint")}
                            action={
                              <Button variant="gold" onClick={() => setAddingAddress(true)}>
                                {t(locale, "checkout.addAddress")}
                              </Button>
                            }
                          />
                        ) : null}

                        {addresses !== null && addresses.length > 0 ? (
                          <RadioGroup
                            label={t(locale, "checkout.savedAddresses")}
                            name="address"
                            value={addressId}
                            onChange={(next) => {
                              setAddressId(next);
                              setRadiusBlocked(false);
                            }}
                            options={addresses.map((address) => ({
                              value: address.id,
                              label: address.recipientName,
                              description: (
                                <>
                                  {address.line1} — {address.city}
                                </>
                              ),
                              trailing: <span className="ps-ltr">{address.phone}</span>
                            }))}
                          />
                        ) : null}

                        {radiusBlocked ? (
                          <Banner tone="danger" title={t(locale, "checkout.outOfRadius")}>
                            {t(locale, "checkout.outOfRadiusHint")}
                          </Banner>
                        ) : null}

                        {addingAddress ? (
                          <form onSubmit={saveAddress}>
                            <Stack gap="sm">
                              <TextField
                                label={t(locale, "checkout.recipientName")}
                                required
                                value={newAddress.recipientName}
                                onChange={(e) => setNewAddress({ ...newAddress, recipientName: e.target.value })}
                              />
                              <TextField
                                label={t(locale, "form.phone")}
                                required
                                forceLtr
                                inputMode="tel"
                                autoComplete="tel"
                                value={newAddress.phone}
                                onChange={(e) => setNewAddress({ ...newAddress, phone: e.target.value })}
                              />
                              <TextField
                                label={t(locale, "checkout.addressLine1")}
                                required
                                value={newAddress.line1}
                                onChange={(e) => setNewAddress({ ...newAddress, line1: e.target.value })}
                              />
                              <TextField
                                label={t(locale, "checkout.city")}
                                required
                                value={newAddress.city}
                                onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })}
                              />
                              <TextField
                                label={t(locale, "checkout.latitude")}
                                hint={t(locale, "checkout.coordinatesHint")}
                                forceLtr
                                inputMode="decimal"
                                value={newAddress.lat}
                                onChange={(e) => setNewAddress({ ...newAddress, lat: e.target.value })}
                              />
                              <TextField
                                label={t(locale, "checkout.longitude")}
                                forceLtr
                                inputMode="decimal"
                                value={newAddress.lng}
                                onChange={(e) => setNewAddress({ ...newAddress, lng: e.target.value })}
                              />
                              <Cluster gap="sm">
                                <Button type="submit" variant="gold" busy={busy}>
                                  {t(locale, "checkout.saveAddress")}
                                </Button>
                                <Button variant="ghost" onClick={() => setAddingAddress(false)}>
                                  {t(locale, "common.cancel")}
                                </Button>
                              </Cluster>
                            </Stack>
                          </form>
                        ) : (
                          <Cluster gap="sm">
                            <Button variant="gold" busy={busy} disabled={!addressId} onClick={confirmAddress}>
                              {t(locale, "checkout.continue")}
                            </Button>
                            <Button variant="ghost" onClick={() => setAddingAddress(true)}>
                              {t(locale, "checkout.addAddress")}
                            </Button>
                          </Cluster>
                        )}
                      </Stack>
                    </Card>
                  ) : null}

                  {/* ---- 2. Delivery slot ------------------------------ */}
                  {step === "slot" && quote ? (
                    <Card>
                      <Stack gap="md">
                        <h2 className="ps-section-head__title">{t(locale, "checkout.chooseSlot")}</h2>
                        <RadioGroup
                          label={t(locale, "checkout.chooseSlot")}
                          name="slot"
                          value={slot}
                          onChange={setSlot}
                          options={quote.slots.map((s) => ({
                            value: s.code,
                            label: t(locale, SLOT_LABEL[s.code] ?? "checkout.stepDelivery"),
                            // A slot whose cut-off has passed stays visible
                            // and disabled: "today" vanishing at 3pm reads as
                            // a bug, while "ordering has closed for this
                            // slot" reads as an explanation.
                            disabled: s.cutoffPassed,
                            description: s.cutoffPassed ? t(locale, "checkout.slotCutoffPassed") : undefined
                          }))}
                        />
                        <Cluster gap="sm">
                          <Button variant="gold" disabled={!slot} onClick={() => setStep("payment")}>
                            {t(locale, "checkout.continue")}
                          </Button>
                          <Button variant="ghost" onClick={() => setStep("address")}>
                            {t(locale, "common.back")}
                          </Button>
                        </Cluster>
                      </Stack>
                    </Card>
                  ) : null}

                  {/* ---- 3. Payment + points -------------------------- */}
                  {step === "payment" ? (
                    <Stack gap="md">
                      <Card>
                        <Stack gap="md">
                          <h2 className="ps-section-head__title">{t(locale, "checkout.paymentMethod")}</h2>
                          <RadioGroup
                            label={t(locale, "checkout.paymentMethod")}
                            name="payment"
                            value={paymentMethod}
                            onChange={setPaymentMethod}
                            options={[
                              {
                                value: "cod",
                                label: statusLabel("payment", locale, "cod"),
                                description: t(locale, "checkout.codDesc")
                              },
                              {
                                value: "bank_transfer",
                                label: statusLabel("payment", locale, "bank_transfer"),
                                description: t(locale, "checkout.bankTransferDesc")
                              },
                              // D-11: the card rail is dormant and stays
                              // dormant. It appears exactly once, disabled and
                              // labelled, so nobody wonders whether they
                              // missed it — and there is no code path here
                              // that could ever enable it.
                              {
                                value: "online",
                                label: t(locale, "checkout.onlinePayment"),
                                disabled: true,
                                trailing: t(locale, "common.comingSoon")
                              }
                            ]}
                          />
                          <LineNote tone="muted">{t(locale, "checkout.noCardYet")}</LineNote>
                        </Stack>
                      </Card>

                      {/* SCR-LE07-001 — redeem at checkout. */}
                      {capPoints > 0 ? (
                        <Card>
                          <Stack gap="md">
                            <h2 className="ps-section-head__title">{t(locale, "loyalty.redeemTitle")}</h2>
                            <LineNote tone="muted">
                              {t(locale, "loyalty.balance")}: {formatPoints(balance)} · {t(locale, "loyalty.redeemRate")}
                            </LineNote>
                            <RangeSlider
                              label={t(locale, "loyalty.redeemTitle")}
                              value={requestedPoints}
                              max={capPoints}
                              step={10}
                              onChange={setRequestedPoints}
                              hint={sliderProps.hint}
                              valueText={sliderProps.valueText}
                              readout={
                                redemption && redemption.allowedPoints > 0 ? (
                                  <>
                                    {formatPoints(redemption.allowedPoints)} {t(locale, "loyalty.points")} ·{" "}
                                    <Money amount={`-${redemption.discountSar}`} locale={locale} />
                                  </>
                                ) : (
                                  formatPoints(0)
                                )
                              }
                            />
                          </Stack>
                        </Card>
                      ) : null}

                      <Cluster gap="sm">
                        <Button variant="gold" onClick={() => setStep("review")}>
                          {t(locale, "checkout.continue")}
                        </Button>
                        <Button variant="ghost" onClick={() => setStep("slot")}>
                          {t(locale, "common.back")}
                        </Button>
                      </Cluster>
                    </Stack>
                  ) : null}

                  {/* ---- 4. Review ------------------------------------ */}
                  {step === "review" ? (
                    <Stack gap="md">
                      <Card>
                        <Stack gap="md">
                          <h2 className="ps-section-head__title">{t(locale, "checkout.reviewTitle")}</h2>

                          <Stack gap="xs">
                            <p className="ps-eyebrow">{t(locale, "checkout.deliverTo")}</p>
                            {selectedAddress ? (
                              <p>
                                {selectedAddress.recipientName} — {selectedAddress.line1}, {selectedAddress.city}
                              </p>
                            ) : null}
                            <Button variant="ghost" size="sm" onClick={() => setStep("address")}>
                              {t(locale, "checkout.editStep")}
                            </Button>
                          </Stack>

                          <Stack gap="xs">
                            <p className="ps-eyebrow">{t(locale, "checkout.chooseSlot")}</p>
                            <p>{slot ? t(locale, SLOT_LABEL[slot] ?? "checkout.stepDelivery") : null}</p>
                            <Button variant="ghost" size="sm" onClick={() => setStep("slot")}>
                              {t(locale, "checkout.editStep")}
                            </Button>
                          </Stack>

                          <Stack gap="xs">
                            <p className="ps-eyebrow">{t(locale, "checkout.paymentMethod")}</p>
                            <p>{statusLabel("payment", locale, paymentMethod)}</p>
                            <Button variant="ghost" size="sm" onClick={() => setStep("payment")}>
                              {t(locale, "checkout.editStep")}
                            </Button>
                          </Stack>
                        </Stack>
                      </Card>

                      <LineList label={t(locale, "orders.items")}>
                        {lines.map((line) => (
                          <LineItem
                            key={line.lineId}
                            title={locale === "ar" ? line.nameAr : line.nameEn}
                            meta={
                              <>
                                {t(locale, "orders.qty")}: <span className="ps-ltr">{count(line.qty)}</span>
                              </>
                            }
                            price={<Money amount={line.unitPrice} locale={locale} />}
                          />
                        ))}
                      </LineList>

                      <Cluster gap="sm">
                        <Button variant="gold" busy={busy} onClick={placeOrder}>
                          {busy ? t(locale, "checkout.placingOrder") : t(locale, "checkout.placeOrder")}
                        </Button>
                        <Button variant="ghost" onClick={() => setStep("payment")}>
                          {t(locale, "common.back")}
                        </Button>
                      </Cluster>
                    </Stack>
                  ) : null}
                </Stack>
              </Rail>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
