"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { TaskDetailResponse } from "@petrospecial/contracts";
import { authedFetch } from "../../../lib/authClient";
import { t } from "../../../lib/locale";
import { useLocale } from "../../../lib/useLocale";

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
  const [otpInput, setOtpInput] = useState("");
  const [photoMediaId, setPhotoMediaId] = useState("");

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

  async function capturePod() {
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/api/v1/driver/tasks/${params.id}/pod`, {
        method: "POST",
        body: JSON.stringify({
          photoMediaId,
          otp: otpInput || undefined,
          collectorKind: "customer",
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
          {/* Photo upload widget (EP-PC-050/051 presigned-URL flow) is not
              wired into this form yet — pasting an already-uploaded media id
              is a deliberate placeholder, not the real driver-facing UX. */}
          <input placeholder="Photo media ID" value={photoMediaId} onChange={(e) => setPhotoMediaId(e.target.value)} />
          {detail.otpRequired && (
            <input placeholder="OTP" value={otpInput} onChange={(e) => setOtpInput(e.target.value)} />
          )}
          <button disabled={busy || !photoMediaId} onClick={capturePod}>
            {t(locale, "arrived")} → POD
          </button>
        </div>
      )}
    </main>
  );
}
