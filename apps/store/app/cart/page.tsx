"use client";

import type { ApplyCouponResponse, CartResponse } from "@petrospecial/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Cluster,
  Container,
  EmptyState,
  Icon,
  IconWell,
  LineItem,
  LineList,
  LineNote,
  Money,
  Page,
  Progress,
  QtyStepper,
  Rail,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  SummaryPanel,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, money, t } from "@petrospecial/i18n";
import { LoginForm } from "../../components/LoginForm";
import { authedFetch, getToken, isSessionEnded } from "../../lib/authClient";

const BLOCKED_ID = "cart-blocked";
const COUPON_NOTE_ID = "cart-coupon-note";

// SCR-SF03-001, hosting SCR-LE02-001 (coupon entry).
//
// Was 18 inline styles, a raw <input type="number"> for the quantity, the
// literal string "failed" in front of anyone whose request errored, and
// #b91c1c — the Raval product-family colour — standing in for an error red on
// three separate lines.
//
// Two rules this screen exists to honour:
//
//  * A line that cannot be bought blocks checkout, and says which line and
//    what to do about it. It does not silently drop out of the total.
//  * A rejected coupon is a sentence, never a hard error, and never blocks
//    checkout (LE-02). The API returns the reason already localised, keyed off
//    the request's own accept-language, so the reader gets it in their
//    language without the client interpreting a code it does not own.
export default function CartPage() {
  const locale = useLocale();
  const [loggedIn, setLoggedIn] = useState<boolean | undefined>(undefined);
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponReason, setCouponReason] = useState<string | null>(null);
  // The quantity the customer just asked for, held locally until the server
  // confirms it. Without this the stepper snaps back to the old number on
  // every click and reads as broken.
  const [pendingQty, setPendingQty] = useState<Record<string, number>>({});
  const [lineBusy, setLineBusy] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(Boolean(getToken()));
  }, []);

  // A session that could not be renewed puts the page back into its
  // signed-out state so the sign-in card reappears. Showing the API's
  // "Incorrect email or password." beside a hidden login form — which is what
  // an expired token used to produce here — left the customer nothing to click.
  const handleError = useCallback(
    (thrown: unknown) => {
      if (isSessionEnded(thrown)) {
        setLoggedIn(false);
        setCart(null);
        setError(null);
        return;
      }
      setError(messageFor(locale, thrown));
    },
    [locale]
  );

  const refresh = useCallback(async () => {
    try {
      setCart(await authedFetch<CartResponse>("/api/v1/cart"));
      setError(null);
    } catch (thrown) {
      handleError(thrown);
    }
  }, [handleError]);

  useEffect(() => {
    if (loggedIn) refresh();
  }, [loggedIn, refresh]);

  async function updateQty(lineId: string, qty: number) {
    setPendingQty((prev) => ({ ...prev, [lineId]: qty }));
    setLineBusy(lineId);
    try {
      await authedFetch(`/api/v1/cart/lines/${lineId}`, { method: "PATCH", body: JSON.stringify({ qty }) });
      await refresh();
    } catch (thrown) {
      handleError(thrown);
    } finally {
      setPendingQty((prev) => {
        const next = { ...prev };
        delete next[lineId];
        return next;
      });
      setLineBusy(null);
    }
  }

  async function removeLine(lineId: string) {
    setLineBusy(lineId);
    try {
      await authedFetch(`/api/v1/cart/lines/${lineId}`, { method: "DELETE" });
      await refresh();
    } catch (thrown) {
      handleError(thrown);
    } finally {
      setLineBusy(null);
    }
  }

  // EP-SF-014/015 (LE-02, S19) — validated live against the real loyalty
  // engine, and re-validated server-side at order placement (routes/
  // checkout.ts), never trusted twice.
  async function applyCoupon(event: React.FormEvent) {
    event.preventDefault();
    if (!couponInput.trim()) return;
    setCouponBusy(true);
    setCouponReason(null);
    try {
      const res = await authedFetch<ApplyCouponResponse>("/api/v1/cart/coupon", {
        method: "POST",
        // The rejection reason is written by the server in one language. Ask
        // for the one the page is being read in.
        headers: { "accept-language": locale },
        body: JSON.stringify({ code: couponInput.trim() })
      });
      if (!res.valid) setCouponReason(res.reason);
      await refresh();
    } catch (thrown) {
      // A rejected coupon is a note. A failed *request* is still an error —
      // but it belongs beside the field it came from, not across the screen.
      if (isSessionEnded(thrown)) handleError(thrown);
      else setCouponReason(messageFor(locale, thrown));
    } finally {
      setCouponBusy(false);
    }
  }

  async function removeCoupon() {
    setCouponBusy(true);
    try {
      await authedFetch("/api/v1/cart/coupon", { method: "DELETE" });
      setCouponInput("");
      setCouponReason(null);
      await refresh();
    } catch (thrown) {
      handleError(thrown);
    } finally {
      setCouponBusy(false);
    }
  }

  const lines = cart?.lines ?? [];
  const blocked = lines.some((line) => !line.inStock);
  const remaining = cart?.freeDeliveryRemaining ?? null;

  // A ratio for the bar, not a figure for the screen. Every amount rendered
  // below is the server's own string, verbatim; these two numbers only decide
  // how far along the track the fill sits, and the bar announces itself with
  // the server's sentence rather than with a number (Progress sets
  // aria-valuetext from `hint`).
  const achieved = cart ? Number(cart.totals.subtotal) + Number(cart.totals.vat) : 0;
  const threshold = remaining ? achieved + Number(remaining) : achieved;

  const summaryRows = cart
    ? [
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
        {
          id: "total",
          label: t(locale, "cart.total"),
          value: <Money amount={cart.totals.total} locale={locale} emphasis="strong" />,
          emphasis: "total" as const
        }
      ]
    : [];

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="cart-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="cart-title" title={t(locale, "cart.title")} />

            {loggedIn === false ? <LoginForm promptKey="auth.leadCart" onLoggedIn={() => setLoggedIn(true)} /> : null}

            {loggedIn && error ? (
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

            {loggedIn && !cart && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="md">
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="lg" />
                </Stack>
              </div>
            ) : null}

            {loggedIn && cart && lines.length === 0 ? (
              <EmptyState
                illustration={<IconWell name="cart" tone="gold" />}
                title={t(locale, "cart.empty")}
                description={t(locale, "cart.emptyHint")}
                action={
                  <ButtonLink linkAs={Link} href="/catalog" variant="gold">
                    {t(locale, "catalog.browse")}
                  </ButtonLink>
                }
              />
            ) : null}

            {loggedIn && cart && lines.length > 0 ? (
              <Rail
                placement="end"
                rail={
                  <Stack gap="md">
                    {/* SCR-LE02-001 — coupon entry. Sits beside the total it
                        changes, because that is the number someone is
                        watching when they type a code. */}
                    <Card>
                      {cart.coupon ? (
                        <Stack gap="sm">
                          <p className="ps-eyebrow">{t(locale, "loyalty.couponApplied")}</p>
                          <Cluster gap="sm">
                            <span className="ps-ltr">{cart.coupon.code}</span>
                            <Money amount={`-${cart.coupon.discountSar}`} locale={locale} />
                          </Cluster>
                          <Cluster gap="sm">
                            <Button variant="ghost" size="sm" busy={couponBusy} onClick={removeCoupon}>
                              {t(locale, "loyalty.removeCoupon")}
                            </Button>
                          </Cluster>
                        </Stack>
                      ) : (
                        <form onSubmit={applyCoupon}>
                          <Stack gap="sm">
                            <TextField
                              label={t(locale, "loyalty.couponCode")}
                              hint={t(locale, "loyalty.couponHint")}
                              value={couponInput}
                              forceLtr
                              autoComplete="off"
                              aria-describedby={couponReason ? COUPON_NOTE_ID : undefined}
                              onChange={(event) => {
                                setCouponInput(event.target.value);
                                setCouponReason(null);
                              }}
                            />
                            {/* Deliberately not an <InlineError> and
                                deliberately not aria-invalid: a coupon that
                                does not apply is information about the
                                coupon, not a mistake the customer made, and
                                it must never stop them checking out. */}
                            {couponReason ? (
                              <div id={COUPON_NOTE_ID} role="status" aria-live="polite">
                                <LineNote tone="warn">{t(locale, "loyalty.couponRejected")}</LineNote>
                                <LineNote tone="muted">{couponReason}</LineNote>
                                <LineNote tone="muted">{t(locale, "loyalty.couponOptional")}</LineNote>
                              </div>
                            ) : null}
                            <Cluster gap="sm">
                              <Button type="submit" variant="ghost" size="sm" busy={couponBusy}>
                                {couponBusy ? t(locale, "loyalty.applyingCoupon") : t(locale, "loyalty.applyCoupon")}
                              </Button>
                            </Cluster>
                          </Stack>
                        </form>
                      )}
                    </Card>

                    <Card aria-live="polite">
                      <SummaryPanel label={t(locale, "cart.summary")} rows={summaryRows}>
                        {remaining ? (
                          <Progress
                            label={t(locale, "cart.freeDeliveryLabel")}
                            value={achieved}
                            max={threshold}
                            hint={t(locale, "cart.freeDeliveryProgress", { amount: money(locale, remaining) })}
                          />
                        ) : (
                          <Progress
                            label={t(locale, "cart.freeDeliveryLabel")}
                            value={1}
                            max={1}
                            tone="success"
                            hint={t(locale, "cart.freeDeliveryReached")}
                          />
                        )}

                        <p className="ps-line-note ps-line-note--muted">{t(locale, "cart.vatIncluded")}</p>

                        {blocked ? (
                          <Banner id={BLOCKED_ID} tone="warn" title={t(locale, "cart.blockedTitle")}>
                            {t(locale, "cart.blockedByUnavailable")}
                          </Banner>
                        ) : null}

                        {/* Blocked, the control stays visible and disabled
                            rather than disappearing: the customer has to be
                            able to see that checkout is the next step and
                            read, in the same glance, what is standing in the
                            way. aria-describedby is what ties the two
                            together for anyone who cannot see them side by
                            side. */}
                        {blocked ? (
                          <Button variant="gold" disabled aria-describedby={BLOCKED_ID}>
                            {t(locale, "cart.checkout")}
                          </Button>
                        ) : (
                          <ButtonLink linkAs={Link} href="/checkout" variant="gold">
                            {t(locale, "cart.checkout")}
                          </ButtonLink>
                        )}

                        <ButtonLink linkAs={Link} href="/catalog" variant="ghost" size="sm">
                          {t(locale, "cart.continueShopping")}
                        </ButtonLink>
                      </SummaryPanel>
                    </Card>
                  </Stack>
                }
              >
                <LineList label={t(locale, "cart.itemsLabel")}>
                  {lines.map((line) => {
                    const name = locale === "ar" ? line.nameAr : line.nameEn;
                    return (
                      <LineItem
                        key={line.lineId}
                        muted={!line.inStock}
                        title={name}
                        meta={
                          <>
                            {t(locale, "cart.unitPrice")}: <Money amount={line.unitPrice} locale={locale} />
                          </>
                        }
                        notes={
                          <>
                            {!line.inStock ? (
                              <LineNote tone="danger">
                                <Icon name="alert" size="sm" /> {t(locale, "cart.unavailable")}
                              </LineNote>
                            ) : null}
                            {line.priceUpdated ? (
                              <LineNote tone="warn">
                                <Icon name="info" size="sm" /> {t(locale, "cart.priceUpdatedHint")}
                              </LineNote>
                            ) : null}
                          </>
                        }
                        control={
                          <QtyStepper
                            label={t(locale, "cart.qtyFor", { name })}
                            value={pendingQty[line.lineId] ?? line.qty}
                            min={1}
                            max={99}
                            disabled={lineBusy === line.lineId}
                            increaseLabel={t(locale, "cart.increase")}
                            decreaseLabel={t(locale, "cart.decrease")}
                            onChange={(next) => updateQty(line.lineId, next)}
                          />
                        }
                        price={<Money amount={line.unitPrice} locale={locale} emphasis="strong" />}
                        action={
                          <Button
                            variant="ghost"
                            size="sm"
                            busy={lineBusy === line.lineId}
                            aria-label={t(locale, "cart.removeLine", { name })}
                            onClick={() => removeLine(line.lineId)}
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
