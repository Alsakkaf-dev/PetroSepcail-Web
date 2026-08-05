"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ManifestResponse } from "@petrospecial/contracts";
import {
  Banner,
  Button,
  ButtonLink,
  Container,
  DateTime,
  EmptyState,
  IconWell,
  Ltr,
  Page,
  Section,
  SectionHead,
  Segmented,
  Skeleton,
  Stack,
  StatusBadge,
  StopCard,
  StopSection,
  type StopKind
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t, type StringKey } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";

type Stop = ManifestResponse["stops"][number];

// D-14's unified handling model: three types, three sections, always.
const SECTIONS: Array<{ kind: StopKind; titleKey: StringKey }> = [
  { kind: "b2b_drop", titleKey: "driver.b2bDrop" },
  { kind: "b2c_home", titleKey: "driver.b2cHome" },
  { kind: "b2c_pickup", titleKey: "driver.b2cPickup" }
];

// SCR-DL08-001 — EP-DL-010. The D-14 centrepiece on the driver's side.
//
// Was an unstyled <ul> of "b2b drop — Al Noor — accepted" with a button after
// it, the raw delivery status included.
//
// Two rules it exists to carry:
//
//  * The three type-grouped sections survive the route-order toggle. Sorting
//    by route reorders stops *inside* each section and never merges them — a
//    driver reconciling at end of shift has to be able to count their
//    wholesale drops without counting past the doorstep deliveries.
//  * Item counts, never prices (04-roles §3). Not the order total, not a unit
//    price, nothing.
export default function ManifestPage() {
  const locale = useLocale();
  const [stops, setStops] = useState<Stop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routeOrder, setRouteOrder] = useState("type");

  const load = useCallback(() => {
    setError(null);
    authedFetch<ManifestResponse>("/api/v1/driver/manifest")
      .then((res) => setStops(res.stops))
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  function stopsFor(kind: StopKind): Stop[] {
    const group = (stops ?? []).filter((stop) => stop.stopType === kind);
    if (routeOrder !== "route") return group;
    // Route order applies inside the section. A stop with no sequence yet
    // sorts last rather than to the top, where it would look like the next
    // thing to do.
    return [...group].sort((a, b) => (a.routeSequence ?? Number.MAX_SAFE_INTEGER) - (b.routeSequence ?? Number.MAX_SAFE_INTEGER));
  }

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="manifest-title">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="manifest-title"
              title={t(locale, "driver.manifestTitle")}
              lead={t(locale, "driver.noPricesHere")}
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
                <Stack gap="md">
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="md" />
                </Stack>
              </div>
            ) : null}

            {stops !== null && stops.length === 0 ? (
              <EmptyState
                illustration={<IconWell name="truck" tone="gold" />}
                title={t(locale, "driver.noStops")}
                description={t(locale, "driver.manifestDesc")}
                action={
                  <ButtonLink linkAs={Link} href="/shift" variant="gold">
                    {t(locale, "nav.shift")}
                  </ButtonLink>
                }
              />
            ) : null}

            {stops !== null && stops.length > 0 ? (
              <Stack gap="lg">
                <Stack gap="sm">
                  <Segmented
                    label={t(locale, "driver.routeOrder")}
                    value={routeOrder}
                    onChange={setRouteOrder}
                    options={[
                      { value: "type", label: t(locale, "driver.routeOrderOff") },
                      { value: "route", label: t(locale, "driver.routeOrderOn") }
                    ]}
                  />
                  <p className="ps-line-note ps-line-note--muted">{t(locale, "driver.groupingKept")}</p>
                </Stack>

                {SECTIONS.map((section) => {
                  const group = stopsFor(section.kind);
                  // A type with no stops today is simply absent — an empty
                  // labelled section on a phone is a heading in the way.
                  if (group.length === 0) return null;
                  return (
                    <StopSection
                      key={section.kind}
                      kind={section.kind}
                      title={t(locale, section.titleKey)}
                      count={count(group.length)}
                    >
                      {group.map((stop) => (
                        <StopCard
                          key={stop.taskId}
                          kind={stop.stopType}
                          kindLabel={t(locale, section.titleKey)}
                          destination={stop.destination.label}
                          status={<StatusBadge kind="delivery" value={stop.status} locale={locale} />}
                          sequence={
                            stop.routeSequence !== null ? (
                              <Ltr>{t(locale, "driver.stopSequence", { n: count(stop.routeSequence) })}</Ltr>
                            ) : null
                          }
                          eta={stop.eta ? <DateTime iso={stop.eta} locale={locale} /> : null}
                          items={<Ltr>{t(locale, "driver.itemCount", { count: count(stop.lines.length) })}</Ltr>}
                          action={
                            <ButtonLink linkAs={Link} href={`/task/${stop.taskId}`} variant="gold">
                              {t(locale, "driver.viewTask")}
                            </ButtonLink>
                          }
                        />
                      ))}
                    </StopSection>
                  );
                })}
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
