"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authedFetch, getToken } from "../../../lib/authClient";
import { dirFor, t } from "../../../lib/locale";
import { useLocale } from "../../../lib/useLocale";

interface TrackingResponse {
  status: string;
  eta: string | null;
  driver: { displayName: string; vehicle: string | null } | null;
  otp: string | null;
  taskId: string | null;
  lastLocation: { lat: number; lng: number; at: string } | null;
}
interface PodResponse {
  photoUrl: string;
  deliveredAt: string;
}

// EP-SP-060/062 (SP-08, S16) — B2B tracking reuses SF-06's own
// tracking/POD shapes verbatim (identical underlying delivery tables).
export default function SupplierOrderTrackingPage() {
  return (
    <Suspense fallback={null}>
      <TrackingPageInner />
    </Suspense>
  );
}

function TrackingPageInner() {
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [tracking, setTracking] = useState<TrackingResponse | null>(null);
  const [pod, setPod] = useState<PodResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push(`/login?lang=${locale}`);
      return;
    }
    authedFetch<TrackingResponse>(`/api/v1/supplier/orders/${params.id}/tracking`)
      .then((res) => {
        setTracking(res);
        if (res.status === "delivered" || res.status === "confirmed_received") {
          authedFetch<PodResponse>(`/api/v1/supplier/orders/${params.id}/pod`)
            .then(setPod)
            .catch(() => {});
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : t(locale, "errorGeneric")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, router, params.id]);


  return (
    <main dir={dirFor(locale)} style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1>{t(locale, "orderTrackingTitle")}</h1>
      {error && <p role="alert">{error}</p>}

      {tracking && (
        <div>
          <p>{t(locale, "statusLabel")} {tracking.status}</p>
          {tracking.eta && <p>{t(locale, "etaLabel")} {new Date(tracking.eta).toLocaleString()}</p>}
          {tracking.driver ? (
            <p>
              {t(locale, "driverLabel")} {tracking.driver.displayName} {tracking.driver.vehicle ? `(${tracking.driver.vehicle})` : ""}
            </p>
          ) : (
            <p>{t(locale, "noDriverYet")}</p>
          )}
          {pod && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontWeight: 700 }}>{t(locale, "podStatus")}</p>
              <p>{new Date(pod.deliveredAt).toLocaleString()}</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
