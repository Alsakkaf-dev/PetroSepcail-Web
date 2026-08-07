"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Badge,
  Banner,
  Breadcrumb,
  Button,
  ButtonLink,
  Card,
  Container,
  FileUpload,
  Icon,
  Page,
  ReasonGate,
  Section,
  SectionHead,
  Stack
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t, type StringKey } from "@petrospecial/i18n";
import { authedFetch } from "../../../../lib/authClient";
import { uploadFile } from "../../../../lib/uploadFile";

/** EP-DL-060's fixed list. `other` is the only one that needs a note, and the
 * gate is what enforces that rather than a hopeful placeholder. */
const REASONS: Array<{ value: string; labelKey: StringKey; needsNote?: boolean }> = [
  { value: "recipient_absent", labelKey: "driver.reasonRecipientAbsent" },
  { value: "address_wrong", labelKey: "driver.reasonAddressWrong" },
  { value: "refused", labelKey: "driver.reasonRefused" },
  { value: "unreachable", labelKey: "driver.reasonUnreachable" },
  { value: "other", labelKey: "driver.reasonOther", needsNote: true }
];

// SCR-DL09-001 — reporting a delivery that could not be completed.
//
// Its own screen rather than a panel folded into the task, for two reasons.
// A driver filing an exception is standing in the street doing something
// consequential, and it deserves the whole screen; and an optional photo has
// nowhere to live inside a card that is already carrying a stepper, a line
// list and a proof-of-delivery form.
//
// The sentence that matters: **the order's status does not change.** A failed
// delivery attempt is not a cancelled order, not a refund, and not a return.
// Support picks it up from here, and the driver is not the one who decides
// what happens to the customer's money.
export default function ExceptionPage() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [photoMediaId, setPhotoMediaId] = useState("");
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickPhoto = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setUploading(true);
      setError(null);
      try {
        setPhotoMediaId(await uploadFile(file, "pod_photo"));
        setPhotoName(file.name);
      } catch (thrown) {
        setError(messageFor(locale, thrown));
      } finally {
        setUploading(false);
      }
    },
    [locale]
  );

  const options = REASONS.map((r) => ({
    value: r.value,
    label: t(locale, r.labelKey),
    ...(r.needsNote ? { requiresNote: true } : {})
  }));

  const submit = useCallback(async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/api/v1/driver/tasks/${params.id}/fail`, {
        method: "POST",
        body: JSON.stringify({
          reasonCode: reason,
          // EP-DL-060 takes a reason code and a note and nothing else — there
          // is no media field on it. The photo is really uploaded, and its id
          // is appended to the note on its own line so support can find it;
          // that is the only place the contract leaves for it. See
          // DEFERRED-DECISIONS §4 item 26.
          ...(note.trim() || photoMediaId
            ? { note: [note.trim(), photoMediaId ? `photo: ${photoMediaId}` : ""].filter(Boolean).join("\n") }
            : {}),
          clientActionId: `${params.id}-fail`
        })
      });
      router.push("/manifest");
    } catch (thrown) {
      setError(messageFor(locale, thrown));
      setBusy(false);
    }
  }, [locale, note, params.id, photoMediaId, reason, router]);

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="exception-title">
        <Container>
          <Stack gap="lg">
            <Breadcrumb
              label={t(locale, "driver.manifestTitle")}
              items={[
                { label: t(locale, "driver.manifestTitle"), href: "/manifest" },
                { label: t(locale, "driver.taskDetails"), href: `/task/${params.id}` },
                { label: t(locale, "driver.exceptionTitle") }
              ]}
            />

            <SectionHead level={1} titleId="exception-title" title={t(locale, "driver.exceptionTitle")} />

            {/* Said before anything is filled in, not after it is sent. */}
            <Banner tone="info" icon="info">
              {t(locale, "driver.exceptionNotice")}
            </Banner>

            {error ? <Banner tone="danger">{error}</Banner> : null}

            <Card>
              <Stack gap="md">
                <FileUpload
                  label={t(locale, "driver.exceptionPhoto")}
                  accept="image/jpeg,image/webp,image/png"
                  capture="environment"
                  browseLabel={t(locale, "driver.uploadPhoto")}
                  hint={t(locale, "common.optional")}
                  onFiles={(files) => void pickPhoto(files)}
                />
                {uploading ? <Banner tone="info">{t(locale, "driver.uploading")}</Banner> : null}
                {photoMediaId ? (
                  <span role="status">
                    <Badge variant="success">
                      <Icon name="check-circle" size="sm" />
                      {photoName ?? t(locale, "driver.photoReady")}
                    </Badge>
                  </span>
                ) : null}

                {/* The gate owns its own commit control, so "is this reason
                    complete" is decided in exactly one place. */}
                <ReasonGate
                  label={t(locale, "driver.failReason")}
                  name="reasonCode"
                  options={options}
                  value={reason}
                  onChange={setReason}
                  note={note}
                  onNoteChange={setNote}
                  noteLabel={t(locale, "form.note")}
                  hint={t(locale, "admin.reasonRequired")}
                >
                  {(ready) => (
                    <Button
                      variant="danger"
                      size="lg"
                      busy={busy}
                      disabled={!ready || uploading}
                      onClick={() => void submit()}
                    >
                      {t(locale, "driver.exceptionSubmit")}
                    </Button>
                  )}
                </ReasonGate>
              </Stack>
            </Card>

            <ButtonLink linkAs={Link} href={`/task/${params.id}`} variant="ghost">
              {t(locale, "common.back")}
            </ButtonLink>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
