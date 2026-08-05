"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banner,
  Button,
  ButtonLink,
  Container,
  DataList,
  DateTime,
  IdDisplay,
  Money,
  Page,
  Section,
  SectionHead,
  Stack
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";

interface RewardItem {
  kind: "early_pay" | "volume";
  valueSar: string;
  sourceRef: string | null;
  createdAt: string;
}

// SCR-LE05-001 — EP-LE-030. A read-only history.
//
// The rule it carries: every reward lands on the debt side as a credit note
// and is never blended with custody (D-14 rule f). Each row therefore links
// to the credit note that carries it, and the standing line under the heading
// says what a reward is — because "reward" beside a cash-custody figure would
// otherwise read as money coming off the amount being held.
export default function RewardsPage() {
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<RewardItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<{ items: RewardItem[] }>("/api/v1/supplier/rewards")
      .then((res) => setItems(res.items))
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
  }, [load, router]);

  const state = error ? "error" : items === null ? "loading" : items.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="rewards-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="rewards-title" title={t(locale, "nav.rewards")} />

            <Banner tone="info">{t(locale, "supplier.rewardsAreCreditNotes")}</Banner>

            {error ? (
              <Button variant="ghost" size="sm" onClick={load}>
                {t(locale, "common.retry")}
              </Button>
            ) : null}

            <DataList
              label={t(locale, "nav.rewards")}
              state={state}
              errorMessage={error ?? undefined}
              onRetry={load}
              retryLabel={t(locale, "common.retry")}
              emptyTitle={t(locale, "supplier.noRewards")}
              emptyDescription={t(locale, "supplier.noRewardsHint")}
              emptyAction={
                <ButtonLink linkAs={Link} href="/statement" variant="gold">
                  {t(locale, "nav.statement")}
                </ButtonLink>
              }
              items={(items ?? []).map((reward, index) => ({
                id: `${reward.createdAt}-${index}`,
                title:
                  reward.kind === "early_pay"
                    ? t(locale, "supplier.rewardEarlyPay")
                    : t(locale, "supplier.rewardVolume"),
                fields: [
                  {
                    label: t(locale, "supplier.rewardValue"),
                    value: <Money amount={reward.valueSar} locale={locale} emphasis="strong" />
                  },
                  { label: t(locale, "orders.placedAt"), value: <DateTime iso={reward.createdAt} locale={locale} /> },
                  ...(reward.sourceRef
                    ? [
                        {
                          label: t(locale, "supplier.creditNotesTotal"),
                          value: (
                            <IdDisplay
                              id={reward.sourceRef}
                              copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                            />
                          )
                        }
                      ]
                    : [])
                ]
              }))}
            />
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
