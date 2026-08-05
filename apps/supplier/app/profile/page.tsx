"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Banner,
  Button,
  Card,
  Cluster,
  Container,
  Icon,
  Ltr,
  Money,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";

interface ProfileResponse {
  businessNameAr: string;
  businessNameEn: string;
  tier: "bronze" | "silver" | "gold";
  creditLimit: string;
  isPickupPoint: boolean;
  geo: { lat: number; lng: number } | null;
  bank: { name: string | null; ibanMasked: string | null };
}

// SCR-SP01-003 — EP-SP-010/011.
//
// Tier, credit limit and pickup-point status are admin-owned (AC-03); a PATCH
// carrying any of them is rejected 403 server-side. They are therefore shown
// as facts with no control on them and a line saying who sets them — rather
// than as greyed-out fields somebody will keep trying to click.
//
// Was six inline styles, a literal #666 for the masked IBAN, unlabelled
// placeholder-only inputs and a literal green tick for "saved".
export default function ProfilePage() {
  const locale = useLocale();
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [businessNameAr, setBusinessNameAr] = useState("");
  const [businessNameEn, setBusinessNameEn] = useState("");
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    authedFetch<ProfileResponse>("/api/v1/supplier/profile")
      .then((res) => {
        setProfile(res);
        setBusinessNameAr(res.businessNameAr);
        setBusinessNameEn(res.businessNameEn);
        setBankName(res.bank.name ?? "");
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
  }, [load, router]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await authedFetch("/api/v1/supplier/profile", {
        method: "PATCH",
        body: JSON.stringify({
          contact: { businessNameAr, businessNameEn },
          bank: { name: bankName || undefined, iban: iban || undefined }
        })
      });
      setSaved(true);
      // The full IBAN is never held on screen after it is sent — the response
      // gives back a masked one, and that is what the account should show.
      setIban("");
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="profile-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="profile-title" title={t(locale, "nav.profile")} />

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

            {!profile && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="md">
                  <Skeleton variant="block" size="md" />
                  <Skeleton variant="block" size="lg" />
                </Stack>
              </div>
            ) : null}

            {profile ? (
              <Stack gap="lg">
                <Card>
                  <Stack gap="md">
                    <Cluster gap="sm">
                      <Badge variant="gold">
                        {t(locale, "supplier.tier")}: {profile.tier}
                      </Badge>
                      <Badge variant="neutral">
                        {t(locale, "supplier.creditLimit")}: <Money amount={profile.creditLimit} locale={locale} />
                      </Badge>
                      {profile.isPickupPoint ? (
                        <Badge variant="blue">
                          <Icon name="package" size="sm" />
                          {t(locale, "supplier.pickupPoint")}
                        </Badge>
                      ) : null}
                    </Cluster>
                    <p className="ps-line-note ps-line-note--muted">{t(locale, "supplier.profileReadOnly")}</p>
                  </Stack>
                </Card>

                <Card>
                  <form onSubmit={save}>
                    <Stack gap="md">
                      <h2 className="ps-section-head__title">{t(locale, "supplier.contactSection")}</h2>
                      <TextField
                        label={t(locale, "supplier.businessNameAr")}
                        required
                        value={businessNameAr}
                        onChange={(event) => setBusinessNameAr(event.target.value)}
                      />
                      <TextField
                        label={t(locale, "supplier.businessNameEn")}
                        required
                        forceLtr
                        value={businessNameEn}
                        onChange={(event) => setBusinessNameEn(event.target.value)}
                      />

                      <h2 className="ps-section-head__title">{t(locale, "supplier.bankSection")}</h2>
                      <Stack gap="xs">
                        <p className="ps-eyebrow">{t(locale, "supplier.ibanMasked")}</p>
                        {/* A masked IBAN is still an IBAN: forced LTR, or the
                            digits reorder inside Arabic copy. */}
                        <Ltr as="code">{profile.bank.ibanMasked ?? "—"}</Ltr>
                      </Stack>
                      <TextField
                        label={t(locale, "supplier.bankName")}
                        value={bankName}
                        onChange={(event) => setBankName(event.target.value)}
                      />
                      <TextField
                        label={t(locale, "orders.iban")}
                        hint={t(locale, "common.optional")}
                        forceLtr
                        autoComplete="off"
                        value={iban}
                        onChange={(event) => setIban(event.target.value)}
                      />

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
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
