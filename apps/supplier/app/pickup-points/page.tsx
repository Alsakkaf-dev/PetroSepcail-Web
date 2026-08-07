"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Container,
  DataList,
  Ltr,
  Map,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  type MapPoint
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { publicGet } from "../../lib/publicApi";

interface PickupPoint {
  supplierId: string;
  businessNameAr: string;
  businessNameEn: string;
  geo: { lat: number; lng: number };
  /** Only computed when the caller supplied a position. */
  distanceKm: number | null;
}

/** Wide enough to be useful in a Saudi city, narrow enough that "nearest"
 * still means something. The endpoint filters server-side. */
const RADIUS_KM = 50;

// SCR-SP01-004 — the public pickup directory. The only unauthenticated screen
// in this portal, and the only one a customer rather than a distributor will
// ever open.
//
// **Zero PII, by construction, not by discipline.** EP-SP-012 returns a
// business name, a coordinate and a distance and nothing else — no contact
// name, no phone, no email, no street address. This screen therefore has
// nothing to withhold, and it says so on the page so nobody later mistakes
// the absence for an oversight and "improves" it.
//
// Geolocation is asked for, never required: without it the points still list,
// just not in distance order, and the screen says which of the two it is.
export default function PickupPointsPage() {
  const locale = useLocale();
  const [points, setPoints] = useState<PickupPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [located, setLocated] = useState<{ lat: number; lng: number } | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(
    (at: { lat: number; lng: number } | null) => {
      setError(null);
      const query = at ? `?lat=${at.lat}&lng=${at.lng}&radiusKm=${RADIUS_KM}` : "";
      publicGet<{ items: PickupPoint[] }>(`/api/v1/pickup-points${query}`)
        .then((page) => setPoints(page.items))
        .catch((thrown) => setError(messageFor(locale, thrown)));
    },
    [locale]
  );

  useEffect(() => {
    load(located);
  }, [load, located]);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setDenied(true);
      return;
    }
    setLocating(true);
    setDenied(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocated({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        // A refused permission is a choice, not a failure. The list still
        // works; it just cannot be ordered by distance.
        setDenied(true);
        setLocating(false);
      },
      { maximumAge: 60_000, timeout: 10_000 }
    );
  }, []);

  const name = (point: PickupPoint) => (locale === "ar" ? point.businessNameAr : point.businessNameEn);

  const mapPoints: MapPoint[] = (points ?? []).map((point, index) => ({
    id: point.supplierId,
    lat: point.geo.lat,
    lng: point.geo.lng,
    label: name(point),
    ...(point.distanceKm === null
      ? {}
      : { detail: t(locale, "map.distanceKm", { km: point.distanceKm.toFixed(1) }) }),
    kind: "b2c_pickup",
    order: index + 1
  }));

  const state = error ? "error" : points === null ? "loading" : points.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="pickup-title">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="pickup-title"
              title={t(locale, "supplier.pickupDirectory")}
              lead={t(locale, "supplier.pickupDirLead")}
              actions={
                <Button variant="dark" size="sm" busy={locating} onClick={locate}>
                  {locating ? t(locale, "supplier.locating") : t(locale, "supplier.useMyLocation")}
                </Button>
              }
            />

            {/* The rule, on the page, in both languages. */}
            <Banner tone="info" icon="shield">
              {t(locale, "supplier.pickupDirPrivacy")}
            </Banner>

            {denied ? <Banner tone="warn">{t(locale, "supplier.locationDenied")}</Banner> : null}

            {error ? (
              <Banner
                tone="danger"
                action={
                  <Button variant="ghost" size="sm" onClick={() => load(located)}>
                    {t(locale, "common.retry")}
                  </Button>
                }
              >
                {error}
              </Banner>
            ) : null}

            {points === null && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="sm">
                  <Skeleton variant="block" size="lg" />
                  <Skeleton variant="block" size="lg" />
                </Stack>
              </div>
            ) : null}

            {points !== null ? (
              <Stack gap="lg">
                <Map
                  label={t(locale, "supplier.pickupDirectory")}
                  points={mapPoints}
                  {...(located ? { center: located } : {})}
                  attribution={t(locale, "map.attribution")}
                  fallbackLabel={t(locale, "supplier.pickupDirectory")}
                  emptyLabel={t(locale, "supplier.pickupDirEmpty")}
                  unavailableLabel={t(locale, "map.unavailable")}
                />

                <DataList
                  label={t(locale, "supplier.pickupDirectory")}
                  state={state}
                  errorMessage={error ?? undefined}
                  onRetry={() => load(located)}
                  retryLabel={t(locale, "common.retry")}
                  emptyTitle={t(locale, "supplier.pickupDirEmpty")}
                  emptyDescription={t(locale, "supplier.pickupDirEmptyHint")}
                  items={(points ?? []).map((point) => ({
                    id: point.supplierId,
                    title: name(point),
                    // Distance and nothing else. No address line, no phone,
                    // no opening hours — the API returns none of them and
                    // this screen invents none.
                    fields:
                      point.distanceKm === null
                        ? []
                        : [
                            {
                              label: t(locale, "supplier.distance"),
                              value: <Ltr>{t(locale, "map.distanceKm", { km: point.distanceKm.toFixed(1) })}</Ltr>
                            }
                          ]
                  }))}
                />
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
