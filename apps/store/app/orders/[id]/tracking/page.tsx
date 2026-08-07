"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Banner,
  Breadcrumb,
  Button,
  ButtonLink,
  Card,
  Container,
  DateTime,
  Ltr,
  Map,
  Page,
  Section,
  SectionHead,
  Skeleton,
  SpecList,
  Stack,
  StatusBadge,
  type MapPoint
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../../../lib/authClient";

interface TrackingResponse {
  status: string;
  eta: string | null;
  driver: { displayName: string; vehicle: string | null } | null;
  /** FR-SF06-005 — only while the task is `en_route` or `arrived`. */
  otp: string | null;
  taskId: string | null;
  lastLocation: { lat: number; lng: number; at: string } | null;
}

/** EP-SF-041 mints a channel token for a live position stream. That stream is
 * Pusher, which DEFERRED-DECISIONS §3 retires in favour of Supabase Realtime,
 * and neither is wired — so this screen polls, and says so rather than
 * pretending the marker is live. Twenty seconds is roughly the ping cadence a
 * driver's device publishes at, so polling faster would mostly re-fetch the
 * same point. */
const POLL_SECONDS = 20;

// SCR-SF06-001 — live delivery tracking. EP-SF-040 has returned an ETA, a
// driver, a delivery OTP and a last known position since S13, and no screen
// has ever read it: the order detail page linked nowhere and the customer's
// only way to know where their delivery was, was to wait for the door.
export default function TrackingPage() {
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = true;
    authedFetch<TrackingResponse>(`/api/v1/orders/${orderId}/tracking`)
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((thrown) => setError(messageFor(locale, thrown)))
      .finally(() => {
        loading.current = false;
      });
  }, [locale, orderId]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [load]);

  const points: MapPoint[] = [];
  if (data?.lastLocation) {
    points.push({
      id: "driver",
      lat: data.lastLocation.lat,
      lng: data.lastLocation.lng,
      label: data.driver?.displayName ?? t(locale, "map.driverHere"),
      detail: <DateTime iso={data.lastLocation.at} locale={locale} />,
      kind: "driver",
      live: true
    });
  }

  // The OTP is minted for `en_route` and `arrived` and withheld otherwise, so
  // its presence is the condition — not a status string this screen would
  // have to keep in step with the API's own list.
  const showOtp = Boolean(data?.otp);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="tracking-title">
        <Container>
          <Stack gap="lg">
            <Breadcrumb
              label={t(locale, "nav.orders")}
              items={[
                { href: "/orders", label: t(locale, "orders.title") },
                { href: `/orders/${orderId}`, label: t(locale, "orders.detailTitle") },
                { label: t(locale, "track.title") }
              ]}
            />

            <SectionHead
              level={1}
              titleId="tracking-title"
              title={t(locale, "track.title")}
              actions={
                <Button variant="dark" size="sm" onClick={load}>
                  {t(locale, "track.refresh")}
                </Button>
              }
            />

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

            {data === null && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "common.loading")}</span>
                <Stack gap="sm">
                  <Skeleton variant="block" size="lg" />
                  <Skeleton variant="block" size="lg" />
                  <Skeleton width="1/2" />
                </Stack>
              </div>
            ) : null}

            {data ? (
              <Stack gap="lg">
                <Card>
                  <Stack gap="md">
                    <StatusBadge kind="order" value={data.status} locale={locale} />
                    <SpecList
                      label={t(locale, "track.title")}
                      rows={[
                        {
                          label: t(locale, "track.eta"),
                          value: data.eta ? <DateTime iso={data.eta} locale={locale} /> : t(locale, "track.noEta")
                        },
                        // FR-SF06-005: the driver's name and vehicle exist on
                        // the response only while the task is live, and vanish
                        // from it the moment the delivery closes. Rendering
                        // "—" would keep a person on screen after they are no
                        // longer part of the order.
                        ...(data.driver
                          ? [
                              { label: t(locale, "track.driver"), value: data.driver.displayName },
                              {
                                label: t(locale, "track.vehicle"),
                                value: data.driver.vehicle ? <Ltr>{data.driver.vehicle}</Ltr> : "—"
                              }
                            ]
                          : [])
                      ]}
                    />
                  </Stack>
                </Card>

                {showOtp ? (
                  // A four-digit code the customer reads aloud to a stranger at
                  // their door. It is set large, forced LTR, and carries the
                  // one instruction that matters: nobody else gets it.
                  <Banner tone="warn" icon="lock" title={t(locale, "track.deliveryCode")}>
                    <Stack gap="sm">
                      <p className="ps-otp">
                        <Ltr>{data.otp}</Ltr>
                      </p>
                      <span>{t(locale, "track.deliveryCodeHint")}</span>
                    </Stack>
                  </Banner>
                ) : null}

                <Banner tone="info" icon="clock">
                  {t(locale, "track.pollingFallback", { seconds: String(POLL_SECONDS) })}
                </Banner>

                {data.taskId ? (
                  <Stack gap="sm">
                    <Map
                      label={t(locale, "track.title")}
                      points={points}
                      attribution={t(locale, "map.attribution")}
                      fallbackLabel={t(locale, "map.places")}
                      emptyLabel={t(locale, "track.noLocation")}
                      unavailableLabel={t(locale, "map.unavailable")}
                    />
                    {data.lastLocation ? (
                      <p className="ps-field__hint">
                        {t(locale, "track.lastSeen")} <DateTime iso={data.lastLocation.at} locale={locale} />
                      </p>
                    ) : null}
                  </Stack>
                ) : (
                  <Banner tone="info" title={t(locale, "track.notDispatched")}>
                    {t(locale, "track.notDispatchedHint")}
                  </Banner>
                )}

                <ButtonLink href={`/orders/${orderId}`} linkAs={Link} variant="dark">
                  {t(locale, "orders.detailTitle")}
                </ButtonLink>
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
