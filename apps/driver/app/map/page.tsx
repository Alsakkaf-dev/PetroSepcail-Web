"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ManifestResponse, RouteResponse } from "@petrospecial/contracts";
import {
  Banner,
  Button,
  ButtonLink,
  Container,
  Map,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  type MapPoint,
  type MapPointKind
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";

type Stop = ManifestResponse["stops"][number];

/** The manifest's three kinds, straight onto the map's pin kinds, so a
 * wholesale drop is the same colour on the list and on the picture. */
const PIN_KIND: Record<Stop["stopType"], MapPointKind> = {
  b2b_drop: "b2b_drop",
  b2c_home: "b2c_home",
  b2c_pickup: "b2c_pickup"
};

// SCR-DL02-001 — the route map.
//
// The folder is `map/`, not `route/`: `route` is the App Router's own
// reserved file name for a Route Handler, and a segment sharing it built as a
// page with no client bundle linked to it.
//
// The pins come from EP-DL-010, not EP-DL-014. The route endpoint returns
// legs with an encoded geometry and a total duration, and it degrades both to
// null whenever no maps vendor is configured — which, per DEFERRED-DECISIONS
// §3, is always, because Google Maps requires a billing account. The manifest
// carries a real `destination.lat/lng` per stop, so that is what gets drawn,
// and the route's duration is shown when it happens to be there.
//
// Tiles are plain images, so the driver's service worker caches them like any
// other asset — which is what "offline cached tiles" means here.
export default function RoutePage() {
  const locale = useLocale();
  const [stops, setStops] = useState<Stop[] | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      authedFetch<ManifestResponse>("/api/v1/driver/manifest"),
      authedFetch<RouteResponse>("/api/v1/driver/route")
    ])
      .then(([manifest, legs]) => {
        setStops(manifest.stops);
        setRoute(legs);
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  // A stop with no coordinate is not a stop with a coordinate of zero. It
  // stays off the picture and keeps its place in the list underneath.
  const points: MapPoint[] = (stops ?? [])
    .filter((stop): stop is Stop & { destination: { label: string; lat: number; lng: number } } =>
      stop.destination.lat !== null && stop.destination.lng !== null
    )
    .map((stop) => ({
      id: stop.taskId,
      lat: stop.destination.lat,
      lng: stop.destination.lng,
      label: stop.destination.label,
      detail: t(locale, "driver.itemCount", { count: count(stop.lines.reduce((sum, line) => sum + line.qty, 0)) }),
      kind: PIN_KIND[stop.stopType],
      ...(stop.routeSequence === null ? {} : { order: stop.routeSequence })
    }));

  const unplotted = (stops ?? []).length - points.length;
  const minutes = route?.totalDurationS === null || route?.totalDurationS === undefined
    ? null
    : Math.round(route.totalDurationS / 60);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="route-title">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="route-title"
              title={t(locale, "driver.routeTitle")}
              actions={
                <Button variant="dark" size="sm" onClick={load}>
                  {t(locale, "common.retry")}
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

            {stops === null && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="sm">
                  <Skeleton variant="block" size="lg" />
                  <Skeleton variant="block" size="lg" />
                </Stack>
              </div>
            ) : null}

            {stops !== null ? (
              <Stack gap="md">
                {minutes === null ? (
                  // The route endpoint answers with nulls whenever no maps
                  // vendor is wired, which is the standing state. Saying that
                  // is better than an empty "Estimated route time" row.
                  <Banner tone="info">{t(locale, "driver.routeEmptyHint")}</Banner>
                ) : (
                  <Banner tone="info" icon="clock">
                    {t(locale, "driver.routeDuration")}: {t(locale, "driver.minutes", { n: count(minutes) })}
                  </Banner>
                )}

                <Map
                  label={t(locale, "driver.routeTitle")}
                  points={points}
                  attribution={t(locale, "map.attribution")}
                  fallbackLabel={t(locale, "driver.manifestTitle")}
                  emptyLabel={t(locale, "driver.noStops")}
                  unavailableLabel={t(locale, "map.unavailable")}
                />

                <p className="ps-field__hint">{t(locale, "map.offlineTiles")}</p>

                {unplotted > 0 ? (
                  // Pickup-point stops have no coordinate source yet, so they
                  // are genuinely absent from the picture. A driver counting
                  // pins against their manifest needs to know that.
                  <Banner tone="warn">{t(locale, "driver.routeEmpty")}</Banner>
                ) : null}

                <ButtonLink linkAs={Link} href="/manifest" variant="dark" size="lg">
                  {t(locale, "nav.manifest")}
                </ButtonLink>
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
