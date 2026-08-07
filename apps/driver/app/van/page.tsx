"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ShiftResponse } from "@petrospecial/contracts";
import {
  Banner,
  Button,
  ButtonLink,
  Container,
  DataList,
  FinancePanel,
  IdDisplay,
  Ltr,
  Money,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  StatCard
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";

// SCR-DL07-003 — van stock and custody funds, on one screen and in two boxes
// that never become one.
//
// D-14 rule (f) on the driver's side: cash a driver is holding was collected
// on the company's behalf. It is not a balance they have earned and it is not
// a debt they owe, and a screen that shows it beside van stock under a single
// heading invites exactly that reading. The custody figure therefore sits in
// a FinancePanel, whose type signature will not let the separation note be
// dropped — the one rule in the component library the compiler enforces.
export default function VanPage() {
  const locale = useLocale();
  const [shift, setShift] = useState<ShiftResponse | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<ShiftResponse>("/api/v1/driver/shift")
      .then(setShift)
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  const stockState = error
    ? "error"
    : shift === undefined
      ? "loading"
      : !shift || shift.vanStock.length === 0
        ? "empty"
        : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="van-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="van-title" title={t(locale, "driver.vanTitle")} />

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

            {shift === undefined && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="sm">
                  <Skeleton variant="block" size="lg" />
                  <Skeleton variant="block" size="lg" />
                </Stack>
              </div>
            ) : null}

            {shift === null ? (
              <Banner tone="info" title={t(locale, "driver.noShift")}>
                {t(locale, "driver.noShiftHint")}
              </Banner>
            ) : null}

            {shift ? (
              <Stack gap="lg">
                {/* ---- Custody funds, in its own box ------------------- */}
                <FinancePanel
                  kind="custody-funds"
                  titleId="van-custody"
                  title={t(locale, "driver.custodyPanel")}
                  separationNote={t(locale, "driver.custodyNotDebt")}
                >
                  <Stack gap="md">
                    <StatCard
                      label={t(locale, "driver.custodyHeld")}
                      value={<Money amount={shift.custodyHeld} locale={locale} emphasis="strong" />}
                      icon="banknote"
                    />
                    {/* EP-DL-002 returns the held total and no movement list,
                        so there is no ledger to draw. Saying that beats an
                        empty table implying nothing has ever been collected. */}
                    <Banner tone="info">{t(locale, "driver.custodyFeedPending")}</Banner>
                    <ButtonLink linkAs={Link} href="/shift" variant="dark">
                      {t(locale, "driver.endShift")}
                    </ButtonLink>
                  </Stack>
                </FinancePanel>

                {/* ---- Van stock, in its own ------------------------- */}
                <Stack gap="md">
                  <h2 className="ps-section-head__title">{t(locale, "driver.vanStock")}</h2>
                  <Stack gap="xs">
                    <span className="ps-field__hint">{t(locale, "driver.vanId")}</span>
                    <IdDisplay
                      id={shift.vanId}
                      copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                    />
                  </Stack>
                  <DataList
                    label={t(locale, "driver.vanStock")}
                    state={stockState}
                    errorMessage={error ?? undefined}
                    onRetry={load}
                    retryLabel={t(locale, "common.retry")}
                    emptyTitle={t(locale, "driver.noVanStock")}
                    emptyDescription={t(locale, "driver.noVanStockHint")}
                    items={shift.vanStock.map((line) => ({
                      id: line.packSizeId,
                      // `catalog.van_stock` carries a pack-size id and no name;
                      // the shortened id plus copy is the honest rendering of
                      // an identifier nobody was given a name for.
                      title: (
                        <IdDisplay
                          id={line.packSizeId}
                          copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                        />
                      ),
                      fields: [{ label: t(locale, "orders.qty"), value: <Ltr>{count(line.qty)}</Ltr> }]
                    }))}
                  />
                </Stack>
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
