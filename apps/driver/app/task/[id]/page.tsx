"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { TaskDetailResponse } from "@petrospecial/contracts";
import {
  Badge,
  Banner,
  Breadcrumb,
  Button,
  ButtonLink,
  Card,
  Cluster,
  Container,
  DataList,
  FileUpload,
  Icon,
  Keypad,
  Ltr,
  Money,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack,
  StatusBadge,
  Stepper,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, messageFor, t, type StringKey } from "@petrospecial/i18n";
import { authedFetch } from "../../../lib/authClient";
import { QUEUED_MEDIA } from "../../../lib/actionQueue";
import { useLocationPing } from "../../../lib/locationPing";
import { sendOrQueue } from "../../../lib/syncClient";
import { OfflineNotice } from "../../../components/OfflineNotice";

// EP-DL-020's four accepted transitions. A status with no entry here has no
// button — an illegal transition is *absent*, not disabled, because a greyed
// control invites a press that can never work and teaches nothing.
const TRANSITIONS: Record<string, { to: string; labelKey: StringKey }> = {
  accepted: { to: "at_pickup", labelKey: "driver.atPickup" },
  at_pickup: { to: "picked_up", labelKey: "driver.pickedUp" },
  picked_up: { to: "en_route", labelKey: "driver.enRoute" },
  en_route: { to: "arrived", labelKey: "driver.markArrived" }
};

// The journey, for the Stepper. `assigned` sits before the first step.
const JOURNEY = ["accepted", "at_pickup", "picked_up", "en_route", "arrived", "delivered"] as const;
const JOURNEY_LABEL: Record<string, StringKey> = {
  accepted: "driver.accept",
  at_pickup: "driver.atPickup",
  picked_up: "driver.pickedUp",
  en_route: "driver.enRoute",
  arrived: "driver.arrived",
  delivered: "driver.markDelivered"
};

const CLOSED = new Set(["delivered", "confirmed", "failed"]);

// SCR-DL04-001 and SCR-DL05-001 — EP-DL-011/012/013/020/040.
//
// Portrait, one-handed, bottom-anchored: the next action is the last thing on
// the screen, where a thumb reaches.
//
// The proof-of-delivery code was a bare `<input placeholder="OTP">`. It is the
// Keypad now — four large targets, forced LTR, and the value carried on one
// labelled input rather than on four unlabelled boxes. The photo control opens
// the rear camera directly instead of a file browser.
export default function TaskPage() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<TaskDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [otp, setOtp] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [queued, setQueued] = useState(false);
  const [codCollected, setCodCollected] = useState("");

  const load = useCallback(() => {
    setError(null);
    authedFetch<TaskDetailResponse>(`/api/v1/driver/tasks/${params.id}`)
      .then(setDetail)
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale, params.id]);

  useEffect(load, [load]);

  useLocationPing(params.id, detail?.task.status === "en_route");

  /** Accept, decline, regenerate-OTP and return-to-hub carry no idempotency
   * key, so replaying one is not provably safe. They fail loudly with no
   * signal, exactly as they always have. */
  async function call(key: string, path: string, body?: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      await authedFetch(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  /** Transition and POD both take a clientActionId, so both survive no
   * signal: the action is held on the device and replayed when the phone
   * finds a network, and the server treats the replay as the same action. */
  async function commit(key: string, path: string, body: Record<string, unknown>, photo?: File) {
    setBusy(key);
    setUploading(Boolean(photo));
    setError(null);
    try {
      const outcome = await sendOrQueue(path, body, {
        clientActionId: String(body.clientActionId),
        ...(photo ? { photo: { file: photo, purpose: "pod_photo" as const } } : {})
      });
      if (outcome === "queued") setQueued(true);
      else load();
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
      setUploading(false);
    }
  }

  /** The file is held, not uploaded on selection. One failure point at submit
   * instead of two, and nothing is uploaded for a proof the driver abandons. */
  function pickPhoto(files: File[]) {
    const file = files[0];
    if (file) setPhotoFile(file);
  }

  if (!detail) {
    return (
      <Page>
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
        ) : (
          <div role="status" aria-live="polite" aria-busy="true">
            <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
            <Stack gap="md">
              <Skeleton width="1/2" />
              <Skeleton variant="block" size="lg" />
            </Stack>
          </div>
        )}
      </Page>
    );
  }

  const status = detail.task.status;
  const next = TRANSITIONS[status];
  const stepIndex = JOURNEY.indexOf(status as (typeof JOURNEY)[number]);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="task-title">
        <Container>
          <Stack gap="lg">
            <Breadcrumb
              label={t(locale, "driver.manifestTitle")}
              items={[
                { label: t(locale, "driver.manifestTitle"), href: "/manifest" },
                { label: t(locale, "driver.taskDetails") }
              ]}
            />

            <SectionHead
              level={1}
              titleId="task-title"
              title={t(locale, "driver.taskDetails")}
              actions={<StatusBadge kind="delivery" value={status} locale={locale} />}
            />

            <OfflineNotice />

            {error ? <Banner tone="danger">{error}</Banner> : null}

            {/* The promise the queue exists to make. Shown where the action
                was taken, not only as a number in the header. */}
            {queued ? (
              <Banner tone="info" icon="offline" title={t(locale, "common.willSync")}>
                {t(locale, "driver.queued")}
              </Banner>
            ) : null}

            <Stepper
              label={t(locale, "orders.timeline")}
              current={stepIndex < 0 ? 0 : stepIndex}
              status={t(locale, "checkout.stepStatus", {
                current: count(Math.max(stepIndex + 1, 1)),
                total: count(JOURNEY.length)
              })}
              stateLabels={{
                done: t(locale, "checkout.stepDone"),
                current: t(locale, "checkout.stepCurrent"),
                upcoming: t(locale, "checkout.stepUpcoming")
              }}
              steps={JOURNEY.map((step) => ({ id: step, label: t(locale, JOURNEY_LABEL[step] ?? "driver.accept") }))}
            />

            {detail.recipient ? (
              <Card>
                <Stack gap="xs">
                  <p className="ps-eyebrow">{t(locale, "driver.recipient")}</p>
                  <p>{detail.recipient.name}</p>
                  {/* A phone number a driver is about to dial, sitting inside
                      Arabic copy: forced LTR, or the digits reorder. */}
                  <Ltr>{detail.recipient.phone}</Ltr>
                </Stack>
              </Card>
            ) : null}

            <Stack gap="md">
              <h2 className="ps-section-head__title">{t(locale, "driver.lines")}</h2>
              <DataList
                label={t(locale, "driver.lines")}
                items={detail.lines.map((line, index) => ({
                  id: `${index}`,
                  title: locale === "ar" ? line.nameAr : line.nameEn,
                  // Quantities only. A manifest line never carries a price.
                  fields: [{ label: t(locale, "orders.qty"), value: <Ltr>{count(line.qty)}</Ltr> }]
                }))}
              />
            </Stack>

            {detail.codAmount ? (
              <Card>
                <Stack gap="xs">
                  <p className="ps-eyebrow">{t(locale, "driver.codAmount")}</p>
                  <Money amount={detail.codAmount} locale={locale} emphasis="strong" />
                </Stack>
              </Card>
            ) : null}

            {/* ---- POD (SCR-DL05-001) ---------------------------------- */}
            {status === "arrived" && detail.task.fulfillmentType === "pickup_point" ? (
              // SCR-DL08-002. Handing a box to a shop is not a delivery to
              // the customer, and the screen that says so owns the whole
              // flow rather than being a value in a dropdown here.
              <ButtonLink linkAs={Link} href={`/task/${params.id}/handover`} variant="gold" size="lg">
                {t(locale, "driver.handoverTitle")}
              </ButtonLink>
            ) : null}

            {status === "arrived" && detail.task.fulfillmentType !== "pickup_point" ? (
              <Card>
                <Stack gap="md">
                  <h2 className="ps-section-head__title">{t(locale, "driver.capturePod")}</h2>

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

                  {detail.otpRequired ? (
                    <Stack gap="sm">
                      <Keypad
                        label={t(locale, "driver.podOtp")}
                        value={otp}
                        onChange={setOtp}
                        deleteLabel={t(locale, "common.remove")}
                      />
                      <Cluster gap="sm">
                        <Button
                          variant="ghost"
                          size="sm"
                          busy={busy === "otp"}
                          onClick={() => call("otp", `/api/v1/driver/tasks/${params.id}/otp/regenerate`)}
                        >
                          {t(locale, "driver.regenerateOtp")}
                        </Button>
                      </Cluster>
                    </Stack>
                  ) : null}

                  {/* No collector picker any more. This form is only reached
                      for a home delivery, so the collector is the customer by
                      construction; a pickup handover has its own screen and
                      sends `supplier` itself. A dropdown here was a way to
                      record the wrong fact by accident. */}

                  {detail.codAmount ? (
                    <TextField
                      label={t(locale, "driver.codCollected")}
                      // Cash collected becomes custody the moment it is
                      // taken — it is not the driver's, and it is not a debt.
                      hint={t(locale, "supplier.custodyNotDebt")}
                      forceLtr
                      inputMode="decimal"
                      value={codCollected}
                      onChange={(event) => setCodCollected(event.target.value)}
                    />
                  ) : null}

                  {!photoFile ? <Banner tone="info">{t(locale, "driver.podNeedsPhoto")}</Banner> : null}

                  <Button
                    variant="gold"
                    size="lg"
                    busy={busy === "pod"}
                    disabled={uploading || !photoFile}
                    onClick={() =>
                      void commit(
                        "pod",
                        `/api/v1/driver/tasks/${params.id}/pod`,
                        {
                          // The real media id is substituted at the moment the
                          // bytes actually land, which offline is later.
                          photoMediaId: QUEUED_MEDIA,
                          ...(otp ? { otp } : {}),
                          collectorKind: "customer",
                          ...(codCollected ? { codCollectedAmount: Number(codCollected) } : {}),
                          clientActionId: `${params.id}-pod`
                        },
                        photoFile ?? undefined
                      )
                    }
                  >
                    {t(locale, "driver.submitPod")}
                  </Button>
                </Stack>
              </Card>
            ) : null}

            {/* ---- The next legal transition, and only that one -------- */}
            {status === "assigned" ? (
              <Cluster gap="sm">
                <Button
                  variant="gold"
                  size="lg"
                  busy={busy === "accept"}
                  onClick={() => call("accept", `/api/v1/driver/tasks/${params.id}/accept`)}
                >
                  {t(locale, "driver.accept")}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  busy={busy === "decline"}
                  onClick={async () => {
                    await call("decline", `/api/v1/driver/tasks/${params.id}/decline`);
                    router.push("/manifest");
                  }}
                >
                  {t(locale, "driver.decline")}
                </Button>
              </Cluster>
            ) : null}

            {next ? (
              <Button
                variant="gold"
                size="lg"
                busy={busy === "transition"}
                onClick={() =>
                  void commit("transition", `/api/v1/driver/tasks/${params.id}/transition`, {
                    to: next.to,
                    clientActionId: `${params.id}-${next.to}`
                  })
                }
              >
                {t(locale, next.labelKey)}
              </Button>
            ) : null}

            {/* ---- Exception path (SCR-DL09-001) ---------------------- */}
            {!CLOSED.has(status) ? (
              <ButtonLink linkAs={Link} href={`/task/${params.id}/exception`} variant="ghost" size="lg">
                {t(locale, "driver.reportException")}
              </ButtonLink>
            ) : null}

            {status === "failed" ? (
              <Button
                variant="gold"
                size="lg"
                busy={busy === "return"}
                onClick={async () => {
                  await call("return", `/api/v1/driver/tasks/${params.id}/return-to-hub`);
                  router.push("/manifest");
                }}
              >
                {t(locale, "driver.returnToHub")}
              </Button>
            ) : null}

            <ButtonLink linkAs={Link} href="/manifest" variant="ghost">
              {t(locale, "common.back")}
            </ButtonLink>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
