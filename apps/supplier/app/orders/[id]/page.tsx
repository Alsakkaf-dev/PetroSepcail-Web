"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Banner,
  Breadcrumb,
  Button,
  Card,
  Container,
  DateTime,
  IdDisplay,
  Map,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  StatusBadge,
  SummaryPanel,
  Timeline
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, statusLabel, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../../lib/authClient";

interface TrackingResponse {
  status: string;
  eta: string | null;
  driver: { displayName: string; vehicle: string | null } | null;
  otp: string | null;
  taskId: string | null;
  lastLocation: { lat: number; lng: number; at: string } | null;
}
interface PodResponse {
  photoUrl: string;
  deliveredAt: string;
}

const DELIVERED = new Set(["delivered", "confirmed_received"]);

// SCR-SP08-001 — EP-SP-060/062. B2B tracking reuses SF-06's own tracking and
// POD shapes, since the underlying delivery tables are identical.
//
// Was three inline styles printing the raw delivery status, a raw
// toLocaleString() timestamp and nothing else. The live map lands in Phase 8:
// the driver's marker while the drop is on the road, with the same textual
// account underneath that every map on this platform ships alongside its
// picture.
export default function SupplierOrderTrackingPage() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [tracking, setTracking] = useState<TrackingResponse | null>(null);
  const [pod, setPod] = useState<PodResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<TrackingResponse>(`/api/v1/supplier/orders/${params.id}/tracking`)
      .then((res) => {
        setTracking(res);
        if (DELIVERED.has(res.status)) {
          authedFetch<PodResponse>(`/api/v1/supplier/orders/${params.id}/pod`)
            .then(setPod)
            .catch(() => setPod(null));
        }
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale, params.id]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
  }, [load, router]);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="tracking-title">
        <Container>
          <Stack gap="lg">
            <Breadcrumb
              label={t(locale, "orders.title")}
              items={[
                { label: t(locale, "nav.dashboard"), href: "/dashboard" },
                { label: t(locale, "orders.title"), href: "/orders" },
                { label: t(locale, "supplier.trackingTitle") }
              ]}
            />

            <SectionHead
              level={1}
              titleId="tracking-title"
              title={t(locale, "supplier.trackingTitle")}
              lead={
                <IdDisplay
                  id={params.id}
                  label={t(locale, "orders.orderNumber")}
                  copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                />
              }
              actions={tracking ? <StatusBadge kind="delivery" value={tracking.status} locale={locale} /> : null}
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

            {!tracking && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="md">
                  <Skeleton width="1/2" />
                  <Skeleton variant="block" size="md" />
                </Stack>
              </div>
            ) : null}

            {tracking ? (
              <Stack gap="md">
                <Card>
                  <SummaryPanel
                    label={t(locale, "supplier.trackingTitle")}
                    rows={[
                      {
                        id: "status",
                        label: t(locale, "orders.timeline"),
                        value: statusLabel("delivery", locale, tracking.status)
                      },
                      {
                        id: "eta",
                        label: t(locale, "supplier.eta"),
                        value: tracking.eta ? <DateTime iso={tracking.eta} locale={locale} /> : "—"
                      },
                      {
                        id: "driver",
                        label: t(locale, "supplier.driver"),
                        value: tracking.driver
                          ? `${tracking.driver.displayName}${tracking.driver.vehicle ? ` — ${tracking.driver.vehicle}` : ""}`
                          : t(locale, "supplier.noDriverYet")
                      }
                    ]}
                  />
                </Card>

                {/* SCR-SP08-001's live map. Only while the drop is actually
                    on the road: EP-SP-060 returns `lastLocation` for
                    `en_route` and null for every other status, so its
                    presence is the condition rather than a status list this
                    screen would have to keep in step with. */}
                {tracking.taskId ? (
                  <Stack gap="sm">
                    <Map
                      label={t(locale, "supplier.trackingTitle")}
                      points={
                        tracking.lastLocation
                          ? [
                              {
                                id: "driver",
                                lat: tracking.lastLocation.lat,
                                lng: tracking.lastLocation.lng,
                                label: tracking.driver?.displayName ?? t(locale, "map.driverHere"),
                                detail: <DateTime iso={tracking.lastLocation.at} locale={locale} />,
                                kind: "driver",
                                live: true
                              }
                            ]
                          : []
                      }
                      attribution={t(locale, "map.attribution")}
                      fallbackLabel={t(locale, "map.places")}
                      emptyLabel={t(locale, "track.noLocation")}
                      unavailableLabel={t(locale, "map.unavailable")}
                    />
                    {tracking.lastLocation ? (
                      <p className="ps-field__hint">
                        {t(locale, "track.lastSeen")} <DateTime iso={tracking.lastLocation.at} locale={locale} />
                      </p>
                    ) : null}
                  </Stack>
                ) : null}

                {pod ? (
                  <Card>
                    <Stack gap="sm">
                      <h2 className="ps-section-head__title">{t(locale, "driver.capturePod")}</h2>
                      <Timeline
                        label={t(locale, "orders.timeline")}
                        entries={[
                          {
                            id: "delivered",
                            title: statusLabel("delivery", locale, "delivered"),
                            timestamp: <DateTime iso={pod.deliveredAt} locale={locale} />,
                            tone: "current"
                          }
                        ]}
                      />
                    </Stack>
                  </Card>
                ) : null}

                <Button variant="ghost" size="sm" onClick={load}>
                  {t(locale, "common.retry")}
                </Button>
              </Stack>
            ) : null}

            <Link href="/orders" className="ps-datalist__link">
              {t(locale, "orders.title")}
            </Link>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
