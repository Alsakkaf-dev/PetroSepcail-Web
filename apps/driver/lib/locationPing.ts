"use client";

import { useEffect, useRef } from "react";
import { sendOrQueue } from "./syncClient";

// EP-DL-030 (session 2, 2026-08-08): POST /driver/tasks/{id}/pings has been
// callable since S11 and SF-06 (the customer's live-tracking screen,
// services/api/src/routes/storefrontFull.ts) reads from the same
// delivery.location_pings table it writes to — but nothing in this app ever
// called it. A customer opening "track my order" for an en_route delivery
// always got lastLocation: null, silently, because no driver device had ever
// produced a ping. This is the first producer.
//
// DEFERRED-DECISIONS.md #30 already names EP-DL-030 pings as one of the four
// queueable actions ("a POD, ping or transition is never lost") alongside
// transitions/POD/fail — so a ping goes through sendOrQueue exactly like
// those, not through a separate best-effort path. clientPingId doubles as
// the queue's own idempotency key.
const MIN_INTERVAL_MS = 20_000;

function newClientPingId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ping-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Watches the device's position and pings it to the server while `active`
 * is true (the task's own `status === "en_route"`). No-ops if geolocation is
 * unsupported or permission is denied — a driver without location access can
 * still complete every other step of the delivery. */
export function useLocationPing(taskId: string, active: boolean): void {
  const lastSentAtRef = useRef(0);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("geolocation" in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (now - lastSentAtRef.current < MIN_INTERVAL_MS) return;
        lastSentAtRef.current = now;

        const { latitude, longitude, heading, speed } = position.coords;
        const clientPingId = newClientPingId();
        void sendOrQueue(
          `/api/v1/driver/tasks/${taskId}/pings`,
          {
            pings: [
              {
                lat: latitude,
                lng: longitude,
                ...(heading !== null ? { heading } : {}),
                ...(speed !== null ? { speed } : {}),
                at: new Date(position.timestamp).toISOString(),
                clientPingId
              }
            ]
          },
          { clientActionId: clientPingId }
        ).catch(() => {
          // A 4xx (rare — the task is validated server-side) is the only way
          // this rejects; a transport failure is already queued by sendOrQueue.
        });
      },
      () => {
        // Permission denied or position unavailable — nothing to do; the
        // delivery flow itself never depends on this succeeding.
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [taskId, active]);
}
