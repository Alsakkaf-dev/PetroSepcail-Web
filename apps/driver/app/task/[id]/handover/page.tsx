"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { TaskDetailResponse } from "@petrospecial/contracts";
import {
  Badge,
  Banner,
  Breadcrumb,
  Button,
  ButtonLink,
  Card,
  Container,
  DataList,
  FileUpload,
  Icon,
  Keypad,
  Ltr,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../../../lib/authClient";
import { QUEUED_MEDIA } from "../../../../lib/actionQueue";
import { sendOrQueue } from "../../../../lib/syncClient";
import { OfflineNotice } from "../../../../components/OfflineNotice";

// SCR-DL08-002 — handing a parcel to a pickup point.
//
// Mechanically this is EP-DL-040 with `collectorKind: "supplier"`, and that
// one field is the whole reason this is its own screen rather than an option
// in a dropdown on the delivery form. A driver who hands a box to a shop and
// taps "delivered" has told the platform something false: the customer has
// not received anything, the parcel is now goods custody, and the collection
// step is still ahead. The banner saying so is the first thing on the screen
// and the last thing above the button.
//
// No cash field. A pickup handover collects nothing — the customer pays at
// collection, and that money becomes the *supplier's* custody, not the
// driver's (SCR-DL08-003).
export default function HandoverPage() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<TaskDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [queued, setQueued] = useState(false);
  const [otp, setOtp] = useState("");

  const load = useCallback(() => {
    setError(null);
    authedFetch<TaskDetailResponse>(`/api/v1/driver/tasks/${params.id}`)
      .then(setDetail)
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale, params.id]);

  useEffect(load, [load]);

  /** Held, not uploaded on selection: the bytes and the action travel
   * together, so a handover captured with no signal is not half-queued. */
  const pickPhoto = useCallback((files: File[]) => {
    const file = files[0];
    if (file) setPhotoFile(file);
  }, []);

  const submit = useCallback(async () => {
    if (!photoFile) return;
    setBusy(true);
    setUploading(true);
    setError(null);
    try {
      const outcome = await sendOrQueue(
        `/api/v1/driver/tasks/${params.id}/pod`,
        {
          photoMediaId: QUEUED_MEDIA,
          ...(otp ? { otp } : {}),
          collectorKind: "supplier",
          clientActionId: `${params.id}-handover`
        },
        { clientActionId: `${params.id}-handover`, photo: { file: photoFile, purpose: "pod_photo" } }
      );
      if (outcome === "queued") setQueued(true);
      else router.push("/manifest");
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
      setUploading(false);
    }
  }, [locale, otp, params.id, photoFile, router]);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="handover-title">
        <Container>
          <Stack gap="lg">
            <Breadcrumb
              label={t(locale, "driver.manifestTitle")}
              items={[
                { label: t(locale, "driver.manifestTitle"), href: "/manifest" },
                { label: t(locale, "driver.taskDetails"), href: `/task/${params.id}` },
                { label: t(locale, "driver.handoverTitle") }
              ]}
            />

            <SectionHead level={1} titleId="handover-title" title={t(locale, "driver.handoverTitle")} />

            {/* The one sentence this screen exists for. */}
            <Banner tone="warn" icon="warning">
              {t(locale, "driver.pickupHandoverNotice")}
            </Banner>

            <OfflineNotice />

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

            {queued ? (
              <Banner tone="info" icon="offline" title={t(locale, "common.willSync")}>
                {t(locale, "driver.queued")}
              </Banner>
            ) : null}

            {detail === null && !error ? (
              <div role="status" aria-live="polite" aria-busy="true">
                <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
                <Stack gap="sm">
                  <Skeleton variant="block" size="lg" />
                  <Skeleton width="1/2" />
                </Stack>
              </div>
            ) : null}

            {detail ? (
              <Stack gap="lg">
                <Stack gap="md">
                  <h2 className="ps-section-head__title">{t(locale, "driver.lines")}</h2>
                  <DataList
                    label={t(locale, "driver.lines")}
                    items={detail.lines.map((line, index) => ({
                      id: `${index}`,
                      title: locale === "ar" ? line.nameAr : line.nameEn,
                      fields: [{ label: t(locale, "orders.qty"), value: <Ltr>{count(line.qty)}</Ltr> }]
                    }))}
                  />
                </Stack>

                <Card>
                  <Stack gap="md">
                    <FileUpload
                      label={t(locale, "driver.podPhoto")}
                      accept="image/jpeg,image/webp,image/png"
                      capture="environment"
                      browseLabel={t(locale, "driver.uploadPhoto")}
                      onFiles={(files) => void pickPhoto(files)}
                    />
                    {uploading ? <Banner tone="info">{t(locale, "driver.uploading")}</Banner> : null}
                    {photoFile ? (
                      <span role="status">
                        <Badge variant="success">
                          <Icon name="check-circle" size="sm" />
                          {photoFile.name}
                        </Badge>
                      </span>
                    ) : null}

                    <Keypad
                      label={t(locale, "driver.handoverOtp")}
                      value={otp}
                      onChange={setOtp}
                      deleteLabel={t(locale, "common.remove")}
                    />
                    <p className="ps-field__hint">{t(locale, "driver.handoverOtpHint")}</p>

                    {!photoFile ? <Banner tone="info">{t(locale, "driver.podNeedsPhoto")}</Banner> : null}

                    <Banner tone="warn" icon="package">
                      {t(locale, "driver.pickupHandoverNotice")}
                    </Banner>

                    <Button
                      variant="gold"
                      size="lg"
                      busy={busy}
                      disabled={uploading || !photoFile}
                      onClick={() => void submit()}
                    >
                      {t(locale, "driver.handoverSubmit")}
                    </Button>
                  </Stack>
                </Card>

                <ButtonLink linkAs={Link} href={`/task/${params.id}`} variant="ghost">
                  {t(locale, "common.back")}
                </ButtonLink>
              </Stack>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
