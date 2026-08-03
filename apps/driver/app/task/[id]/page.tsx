"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { TaskDetailResponse } from "@petrospecial/contracts";
import { authedFetch } from "../../../lib/authClient";
import { t } from "../../../lib/locale";
import { useLocale } from "../../../lib/useLocale";
import { uploadFile } from "../../../lib/uploadFile";

const FAIL_REASONS = ["recipient_absent", "address_wrong", "refused", "unreachable", "other"] as const;
const REASON_LABEL_KEY: Record<(typeof FAIL_REASONS)[number], "reasonRecipientAbsent" | "reasonAddressWrong" | "reasonRefused" | "reasonUnreachable" | "reasonOther"> = {
  recipient_absent: "reasonRecipientAbsent",
  address_wrong: "reasonAddressWrong",
  refused: "reasonRefused",
  unreachable: "reasonUnreachable",
  other: "reasonOther"
};

// EP-DL-011/012/013/020 (DL-01/DL-04, S10) — task detail + the driver's
// available actions for it. Only the 4 EP-DL-020 transitions this session's
// backend accepts are offered (at_pickup/picked_up/en_route/arrived);
// 'delivered' needs POD (EP-DL-040, DL-05/S12), not built yet, so there is
// deliberately no button for it.
const TRANSITIONS: Record<string, { to: "at_pickup" | "picked_up" | "en_route" | "arrived"; labelKey: "atPickup" | "pickedUp" | "enRoute" | "arrived" }> = {
  accepted: { to: "at_pickup", labelKey: "atPickup" },
  at_pickup: { to: "picked_up", labelKey: "pickedUp" },
  picked_up: { to: "en_route", labelKey: "enRoute" },
  en_route: { to: "arrived", labelKey: "arrived" }
};

export default function TaskPage() {
  return (
    <Suspense fallback={null}>
      <TaskPageInner />
    </Suspense>
  );
}

function TaskPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<TaskDetailResponse | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [photoMediaId, setPhotoMediaId] = useState("");
  const [collectorKind, setCollectorKind] = useState<"customer" | "supplier">("customer");
  const [codCollected, setCodCollected] = useState("");
  const [failReason, setFailReason] = useState<(typeof FAIL_REASONS)[number]>("recipient_absent");
  const [failNote, setFailNote] = useState("");

  function load() {
    authedFetch<TaskDetailResponse>(`/api/v1/driver/tasks/${params.id}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
  }

  useEffect(load, [locale, params.id]);

  async function act(action: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/api/v1/driver/tasks/${params.id}/${action}`, { method: "POST" });
      if (action === "decline") router.push(`/manifest?lang=${locale}`);
      else load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: string) {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/api/v1/driver/tasks/${params.id}/transition`, {
        method: "POST",
        body: JSON.stringify({ to, clientActionId: `${params.id}-${to}-${Date.now()}` })
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const mediaId = await uploadFile(file, "pod_photo");
      setPhotoMediaId(mediaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setUploading(false);
    }
  }

  async function capturePod() {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/api/v1/driver/tasks/${params.id}/pod`, {
        method: "POST",
        body: JSON.stringify({
          photoMediaId,
          otp: otpInput || undefined,
          collectorKind,
          codCollectedAmount: codCollected ? Number(codCollected) : undefined,
          clientActionId: `${params.id}-pod-${Date.now()}`
        })
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function regenerateOtp() {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/api/v1/driver/tasks/${params.id}/otp/regenerate`, { method: "POST" });
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function failDelivery() {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/api/v1/driver/tasks/${params.id}/fail`, {
        method: "POST",
        body: JSON.stringify({
          reasonCode: failReason,
          note: failNote || undefined,
          clientActionId: `${params.id}-fail-${Date.now()}`
        })
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function returnToHub() {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/api/v1/driver/tasks/${params.id}/return-to-hub`, { method: "POST" });
      router.push(`/manifest?lang=${locale}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(locale, "errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <p>{t(locale, "loading")}</p>;

  const nextTransition = TRANSITIONS[detail.task.status];

  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"}>
      <button onClick={() => router.push(`/manifest?lang=${locale}`)}>{t(locale, "back")}</button>
      <h1>{t(locale, "taskDetails")}</h1>
      {error && <p role="alert">{error}</p>}
      <p>{detail.task.status}</p>

      {detail.recipient && (
        <p>
          {t(locale, "recipient")}: {detail.recipient.name} — {detail.recipient.phone}
        </p>
      )}

      <h2>{t(locale, "lines")}</h2>
      <ul>
        {detail.lines.map((line, i) => (
          <li key={i}>
            {locale === "ar" ? line.nameAr : line.nameEn} × {line.qty}
          </li>
        ))}
      </ul>

      {detail.codAmount && (
        <p>
          {t(locale, "codAmount")}: {detail.codAmount}
        </p>
      )}

      {detail.task.status === "assigned" && (
        <div>
          <button disabled={busy} onClick={() => act("accept")}>{t(locale, "accept")}</button>
          <button disabled={busy} onClick={() => act("decline")}>{t(locale, "decline")}</button>
        </div>
      )}

      {nextTransition && (
        <button disabled={busy} onClick={() => transition(nextTransition.to)}>
          {t(locale, "transitionTo")}: {t(locale, nextTransition.labelKey)}
        </button>
      )}

      {detail.task.status === "arrived" && (
        <div>
          <h2>{t(locale, "uploadPhoto")}</h2>
          <input type="file" accept="image/jpeg,image/webp,image/png" capture="environment" disabled={uploading} onChange={pickPhoto} />
          {uploading && <p>{t(locale, "uploading")}</p>}
          {photoMediaId && <p>✓ {photoMediaId}</p>}

          {detail.otpRequired && (
            <div>
              <input placeholder="OTP" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} />
              <button type="button" disabled={busy} onClick={regenerateOtp}>
                {t(locale, "regenerateOtp")}
              </button>
            </div>
          )}

          <label>
            {t(locale, "collectorKind")}
            <select value={collectorKind} onChange={(e) => setCollectorKind(e.target.value as "customer" | "supplier")}>
              <option value="customer">{t(locale, "collectorCustomer")}</option>
              <option value="supplier">{t(locale, "collectorSupplier")}</option>
            </select>
          </label>

          {detail.codAmount && (
            <label>
              {t(locale, "codCollected")}
              <input type="number" min={0} step="0.01" value={codCollected} onChange={(e) => setCodCollected(e.target.value)} />
            </label>
          )}

          <button disabled={busy || uploading || !photoMediaId} onClick={capturePod}>
            {t(locale, "submitPod")}
          </button>
        </div>
      )}

      {detail.task.status !== "delivered" && detail.task.status !== "confirmed" && detail.task.status !== "failed" && (
        <details>
          <summary>{t(locale, "failTask")}</summary>
          <label>
            {t(locale, "reasonCode")}
            <select value={failReason} onChange={(e) => setFailReason(e.target.value as (typeof FAIL_REASONS)[number])}>
              {FAIL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(locale, REASON_LABEL_KEY[r])}
                </option>
              ))}
            </select>
          </label>
          <input placeholder={t(locale, "note")} value={failNote} onChange={(e) => setFailNote(e.target.value)} />
          <button type="button" disabled={busy} onClick={failDelivery}>
            {t(locale, "submit")}
          </button>
        </details>
      )}

      {detail.task.status === "failed" && (
        <button disabled={busy} onClick={returnToHub}>
          {t(locale, "returnToHub")}
        </button>
      )}
    </main>
  );
}
