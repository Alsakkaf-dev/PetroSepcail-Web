"use client";

import { useEffect, useState } from "react";
import { Banner, Countdown, Stack } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, t, type Locale } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../lib/authClient";

interface Campaign {
  id: string;
  nameAr: string;
  nameEn: string;
  endsAt: string;
}

function remaining(locale: Locale, parts: { days: number; hours: number; minutes: number; seconds: number }): string {
  if (parts.days > 0) {
    return t(locale, "common.remainingDays", { days: count(parts.days), hours: count(parts.hours) });
  }
  if (parts.hours > 0) {
    return t(locale, "common.remainingHours", { hours: count(parts.hours), minutes: count(parts.minutes) });
  }
  return t(locale, "common.remainingMinutes", { minutes: count(parts.minutes), seconds: count(parts.seconds) });
}

/**
 * `SCR-LE03-001` — the campaign banner on the catalogue.
 *
 * "Eligible actors only" is enforced where it has to be: `EP-LE-040` is an
 * authenticated route whose query runs under RLS, so a signed-out visitor
 * never receives a campaign and this component renders nothing at all rather
 * than advertising an offer nobody can claim.
 *
 * Not family-accented, which the screen spec asks for: `loyalty.campaigns`
 * carries a name and an end date and no family, so there is nothing to accent
 * *from*. Colour-coding by guess would put a Raval mark on a Petrotoryon
 * offer. See DEFERRED-DECISIONS §4 item 28.
 */
export function CampaignBanner() {
  const locale = useLocale();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    authedFetch<{ items: Campaign[] }>("/api/v1/loyalty/campaigns/active")
      .then((page) => {
        if (!cancelled) setCampaigns(page.items);
      })
      // A campaign banner is the least important thing on the catalogue. If
      // it cannot load, the catalogue is still the catalogue.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (campaigns.length === 0) return null;

  return (
    <Stack gap="sm">
      {campaigns.map((campaign) => (
        <Banner
          key={campaign.id}
          tone="info"
          icon="tag"
          title={locale === "ar" ? campaign.nameAr : campaign.nameEn}
        >
          <Countdown
            deadline={campaign.endsAt}
            label={t(locale, "loyalty.campaignEnds")}
            expiredLabel={t(locale, "loyalty.campaignEnded")}
            format={(parts) => remaining(locale, parts)}
            urgentBelowMs={24 * 60 * 60 * 1000}
          />
        </Banner>
      ))}
    </Stack>
  );
}
