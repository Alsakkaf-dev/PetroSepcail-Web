"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banner,
  Button,
  Card,
  Container,
  DataList,
  FinancePanel,
  Page,
  Section,
  SectionHead,
  Stack,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { t } from "@petrospecial/i18n";
import { getToken } from "../../lib/authClient";

// SCR-DL08-003 — a pickup point handing a parcel to the customer who came to
// collect it.
//
// The one rule this screen exists to hold: **cash collected here is custody,
// never credit.** A distributor holding a customer's SAR 180 has not reduced
// what they owe the company by SAR 180 and has not earned SAR 180 — the money
// is the company's, in their till, for now. That is D-14 rule (f) at the
// counter, and it is why the amount field sits inside a custody panel whose
// type signature will not let the separation note be dropped.
//
// **Nothing here is live.** `delivery.v_supplier_pickup_custody` — EP-SP-043's
// own data source — is owned by DL-08 and was never built, and there is no
// endpoint anywhere that verifies a collection code or records a handover.
// The screen is complete, the form is disabled, and the banner says which
// piece is missing. Same call as the goods-custody panel on /custody and the
// fleet map in the console: build the surface, key it off the field, and say
// plainly when the feed is not live.
export default function CollectionsPage() {
  const locale = useLocale();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [cash, setCash] = useState("");

  useEffect(() => {
    if (!getToken()) router.push("/login");
  }, [router]);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="collections-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="collections-title" title={t(locale, "supplier.collectTitle")} />

            <Banner tone="info" icon="info">
              {t(locale, "supplier.collectFeedPending")}
            </Banner>

            <DataList
              label={t(locale, "supplier.collectTitle")}
              state="empty"
              emptyTitle={t(locale, "supplier.collectEmpty")}
              emptyDescription={t(locale, "supplier.collectFeedPending")}
              items={[]}
            />

            <Card>
              <Stack gap="md">
                <TextField
                  label={t(locale, "supplier.collectCode")}
                  name="collectionCode"
                  forceLtr
                  inputMode="numeric"
                  disabled
                  hint={t(locale, "supplier.collectCodeHint")}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />

                {/* The amount lives inside the custody panel, not beside the
                    code, because where a figure sits on a screen is half of
                    what it means. */}
                <FinancePanel
                  kind="custody-funds"
                  titleId="collect-custody"
                  title={t(locale, "supplier.custodyPanel")}
                  separationNote={t(locale, "supplier.collectCashNote")}
                >
                  <TextField
                    label={t(locale, "supplier.collectCash")}
                    name="cashCollected"
                    forceLtr
                    inputMode="decimal"
                    disabled
                    value={cash}
                    onChange={(event) => setCash(event.target.value)}
                  />
                </FinancePanel>

                {/* Visible, disabled, and explained — the same treatment the
                    dormant online-payment option gets in the cart, and for the
                    same reason: hiding it would leave the screen looking as
                    though the job could not be done here at all. */}
                <Button variant="gold" size="lg" disabled>
                  {t(locale, "supplier.collectSubmit")}
                </Button>
                <p className="ps-field__hint">{t(locale, "supplier.collectDisabled")}</p>
              </Stack>
            </Card>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
