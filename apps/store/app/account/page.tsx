"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  Card,
  Cluster,
  Container,
  DataList,
  DateTime,
  Grid,
  Icon,
  IdDisplay,
  Ltr,
  Money,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  StatCard,
  StatusBadge,
  Switch,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, points as formatPoints, t, type StringKey } from "@petrospecial/i18n";
import { LoginForm } from "../../components/LoginForm";
import { authedFetch, getToken, isSessionEnded } from "../../lib/authClient";

interface MeResponse {
  fullName: string;
  email: string;
  phone: string;
  locale: "ar" | "en";
}
interface AccountOverview {
  recentOrders: Array<{ orderId: string; status: string; total: string; placedAt: string }>;
  pointsBalance: number;
  addressCount: number;
  openReturns: number;
}
interface LoyaltyOverview {
  balance: number;
  redeemRate: { points: number; sar: number };
  entries: Array<{ delta: number; reason: string; at: string }>;
  /** LE-EXP-1. `loyalty.points_expiring_soon()` exists in the database and is
   * read by the notification hub, but EP-SF-081 does not carry it yet — so
   * this is optional and the chip below renders only when it arrives. A
   * warning about points expiring is not something to guess at from a
   * ledger's created_at timestamps. See DEFERRED-DECISIONS §4 item 20. */
  expiringSoon?: number;
}
interface ConsentItem {
  kind: "service_terms" | "privacy" | "marketing";
  granted: boolean;
}

const LEDGER_KIND: Record<string, StringKey> = {
  earn: "loyalty.kindEarn",
  redeem: "loyalty.kindRedeem",
  reverse: "loyalty.kindReverse",
  expire: "loyalty.kindExpire",
  restore: "loyalty.kindRestore"
};

// SCR-SF10-001, hosting SCR-LE01-001 (points balance & history).
//
// Was 15 inline styles, a bare unlabelled input for the customer's own name, a
// literal #1a7f4e "saved" message and a literal #b91c1c error line — a family
// colour and an invented green, neither of which is a status token.
//
// The loyalty fragment is the part with a rule attached: the ledger is
// append-only by construction (0069 revokes update and delete on it), so the
// screen shows it as a running list of movements with their own signs, and
// offers no edit or delete control anywhere — because there is nothing behind
// one.
export default function AccountPage() {
  const locale = useLocale();
  const [loggedIn, setLoggedIn] = useState<boolean | undefined>(undefined);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyOverview | null>(null);
  const [consents, setConsents] = useState<ConsentItem[] | null>(null);
  const [fullName, setFullName] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(Boolean(getToken()));
  }, []);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      authedFetch<MeResponse>("/api/v1/me"),
      authedFetch<AccountOverview>("/api/v1/account/overview"),
      authedFetch<LoyaltyOverview>("/api/v1/account/loyalty"),
      authedFetch<{ items: ConsentItem[] }>("/api/v1/account/consents")
    ])
      .then(([meRes, overviewRes, loyaltyRes, consentsRes]) => {
        setMe(meRes);
        setFullName(meRes.fullName);
        setOverview(overviewRes);
        setLoyalty(loyaltyRes);
        setConsents(consentsRes.items);
      })
      .catch((thrown) => {
        if (isSessionEnded(thrown)) return setLoggedIn(false);
        setError(messageFor(locale, thrown));
      });
  }, [locale]);

  useEffect(() => {
    if (loggedIn) load();
  }, [loggedIn, load]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await authedFetch<MeResponse>("/api/v1/me", {
        method: "PATCH",
        body: JSON.stringify({ fullName })
      });
      setMe(updated);
      setSaved(true);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  async function setMarketing(granted: boolean) {
    setError(null);
    // Optimistic, because a consent toggle that waits a round trip before it
    // moves reads as broken and gets clicked twice.
    setConsents((prev) => (prev ?? []).map((c) => (c.kind === "marketing" ? { ...c, granted } : c)));
    try {
      await authedFetch("/api/v1/account/consents", {
        method: "PATCH",
        body: JSON.stringify({ marketing: granted })
      });
      const res = await authedFetch<{ items: ConsentItem[] }>("/api/v1/account/consents");
      setConsents(res.items);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
      setConsents((prev) => (prev ?? []).map((c) => (c.kind === "marketing" ? { ...c, granted: !granted } : c)));
    }
  }

  const marketing = consents?.find((c) => c.kind === "marketing");
  const loading = loggedIn && !me && !error;

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="account-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="account-title" title={t(locale, "account.title")} />

            {loggedIn === false ? <LoginForm promptKey="auth.leadAccount" onLoggedIn={() => setLoggedIn(true)} /> : null}

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

            {loading ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="md">
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="lg" />
                </Stack>
              </div>
            ) : null}

            {loggedIn && me ? (
              <Stack gap="lg">
                {/* ---- Quick tiles ------------------------------------ */}
                {overview ? (
                  <Stack gap="md">
                    {/* Three tiles, three real figures. There is deliberately
                        no "orders" tile: /account/overview returns the last
                        five orders, not a total, and a tile reading "5" that
                        actually means "at least 5" is worse than no tile. */}
                    <Grid cols="3" aria-label={t(locale, "account.overview")}>
                      <StatCard
                        tone="gold"
                        label={t(locale, "account.pointsTile")}
                        value={<Ltr>{formatPoints(overview.pointsBalance)}</Ltr>}
                        caption={t(locale, "loyalty.redeemRate")}
                        icon="star"
                      />
                      <StatCard
                        label={t(locale, "account.savedAddresses")}
                        value={<Ltr>{count(overview.addressCount)}</Ltr>}
                        icon="map-pin"
                      />
                      <StatCard
                        linkAs={Link}
                        href="/returns"
                        label={t(locale, "account.openReturns")}
                        value={<Ltr>{count(overview.openReturns)}</Ltr>}
                        icon="retry"
                      />
                    </Grid>
                    <Cluster gap="sm" aria-label={t(locale, "account.quickLinks")}>
                      <ButtonLink linkAs={Link} href="/orders" variant="ghost" size="sm">
                        {t(locale, "orders.title")}
                      </ButtonLink>
                      <ButtonLink linkAs={Link} href="/wishlist" variant="ghost" size="sm">
                        {t(locale, "nav.wishlist")}
                      </ButtonLink>
                      <ButtonLink linkAs={Link} href="/returns" variant="ghost" size="sm">
                        {t(locale, "nav.returns")}
                      </ButtonLink>
                      {/* SCR-SF10-002's entry point. Consent, data export and
                          deletion had no route at all before Phase 8, so the
                          only PDPL rights a customer could exercise were the
                          ones they could reach by emailing somebody. */}
                      <ButtonLink linkAs={Link} href="/account/preferences" variant="ghost" size="sm">
                        {t(locale, "account.preferences")}
                      </ButtonLink>
                    </Cluster>
                  </Stack>
                ) : null}

                {/* ---- Profile --------------------------------------- */}
                <Card>
                  <form onSubmit={saveProfile}>
                    <Stack gap="md">
                      <h2 className="ps-section-head__title">{t(locale, "account.profile")}</h2>
                      <TextField
                        label={t(locale, "form.fullName")}
                        required
                        autoComplete="name"
                        value={fullName}
                        onChange={(event) => {
                          setFullName(event.target.value);
                          setSaved(false);
                        }}
                      />
                      {/* Read-only, and said so rather than shown as a
                          greyed field someone will keep trying to click.
                          Both are forced LTR — an email or a +966 number
                          reorders inside Arabic copy without it. */}
                      <Stack gap="xs">
                        <p className="ps-eyebrow">{t(locale, "form.email")}</p>
                        <Ltr>{me.email}</Ltr>
                      </Stack>
                      <Stack gap="xs">
                        <p className="ps-eyebrow">{t(locale, "form.phone")}</p>
                        <Ltr>{me.phone}</Ltr>
                      </Stack>
                      <p className="ps-line-note ps-line-note--muted">{t(locale, "account.contactLocked")}</p>
                      <Cluster gap="sm">
                        <Button type="submit" variant="gold" busy={busy}>
                          {t(locale, "common.save")}
                        </Button>
                        {saved ? (
                          <span role="status">
                            <Badge variant="success">
                              <Icon name="check-circle" size="sm" />
                              {t(locale, "common.saved")}
                            </Badge>
                          </span>
                        ) : null}
                      </Cluster>
                    </Stack>
                  </form>
                </Card>

                {/* ---- SCR-LE01-001: points balance & history --------- */}
                {loyalty ? (
                  <Card className="ps-loyalty">
                    <Stack gap="md">
                      <Cluster gap="md" justify="between">
                        <Stack gap="xs">
                          <p className="ps-eyebrow">{t(locale, "loyalty.balance")}</p>
                          {/* The one gold headline on the screen. --gold-700
                              carries it because it is --fs-700 display type,
                              which is held to 3:1, not 4.5:1. */}
                          <p className="ps-loyalty__balance">
                            <Ltr>{formatPoints(loyalty.balance)}</Ltr>{" "}
                            <span className="ps-loyalty__unit">{t(locale, "loyalty.pointsUnit")}</span>
                          </p>
                          <p className="ps-line-note ps-line-note--muted">{t(locale, "loyalty.redeemRate")}</p>
                        </Stack>
                        {loyalty.expiringSoon && loyalty.expiringSoon > 0 ? (
                          // Flame carries urgency here, and the words carry
                          // the meaning: a chip that is only orange says
                          // nothing to anyone who cannot see orange.
                          <Badge variant="flame">
                            <Icon name="clock" size="sm" />
                            {t(locale, "loyalty.expiringSoonCount", { points: formatPoints(loyalty.expiringSoon) })}
                          </Badge>
                        ) : null}
                      </Cluster>

                      <h2 className="ps-section-head__title">{t(locale, "loyalty.ledger")}</h2>
                      <p className="ps-line-note ps-line-note--muted">{t(locale, "loyalty.ledgerAppendOnly")}</p>

                      <DataList
                        label={t(locale, "loyalty.ledger")}
                        state={loyalty.entries.length === 0 ? "empty" : "ready"}
                        emptyTitle={t(locale, "loyalty.noHistory")}
                        emptyDescription={t(locale, "loyalty.noHistoryHint")}
                        items={loyalty.entries.map((entry, index) => ({
                          id: `${entry.at}-${index}`,
                          title: t(locale, LEDGER_KIND[entry.reason] ?? "loyalty.points"),
                          fields: [
                            {
                              label: t(locale, "loyalty.points"),
                              // The sign is part of the value, not a colour:
                              // a redemption is a negative line in an
                              // append-only ledger and reads as one.
                              value: (
                                <Ltr>
                                  {entry.delta > 0 ? "+" : ""}
                                  {formatPoints(entry.delta)}
                                </Ltr>
                              )
                            },
                            { label: t(locale, "orders.placedAt"), value: <DateTime iso={entry.at} locale={locale} /> }
                          ]
                        }))}
                      />
                    </Stack>
                  </Card>
                ) : null}

                {/* ---- Recent orders --------------------------------- */}
                {overview && overview.recentOrders.length > 0 ? (
                  <Stack gap="md">
                    <h2 className="ps-section-head__title">{t(locale, "account.recentOrders")}</h2>
                    <DataList
                      label={t(locale, "account.recentOrders")}
                      items={overview.recentOrders.map((order) => ({
                        id: order.orderId,
                        href: `/orders/${order.orderId}`,
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
                          { label: t(locale, "cart.total"), value: <Money amount={order.total} locale={locale} /> }
                        ]
                      }))}
                    />
                    <Cluster gap="sm">
                      <ButtonLink linkAs={Link} href="/orders" variant="ghost" size="sm">
                        {t(locale, "orders.title")}
                      </ButtonLink>
                    </Cluster>
                  </Stack>
                ) : null}

                {/* ---- Consents -------------------------------------- */}
                {consents ? (
                  <Card>
                    <Stack gap="md">
                      <h2 className="ps-section-head__title">{t(locale, "account.consentsTitle")}</h2>
                      <Switch
                        label={t(locale, "account.marketingOptIn")}
                        description={t(locale, "account.marketingWithdrawAnytime")}
                        checked={marketing?.granted ?? false}
                        onChange={setMarketing}
                      />
                      {/* Service terms and privacy are conditions of having an
                          account, not preferences — shown as granted, with no
                          control, because withdrawing them is account
                          deletion and that is its own flow. */}
                      <Cluster gap="sm">
                        <Badge variant="neutral">
                          {t(locale, "auth.consentService")} — {t(locale, "account.consentGranted")}
                        </Badge>
                        <Badge variant="neutral">
                          {t(locale, "auth.consentPrivacy")} — {t(locale, "account.consentGranted")}
                        </Badge>
                      </Cluster>
                    </Stack>
                  </Card>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
