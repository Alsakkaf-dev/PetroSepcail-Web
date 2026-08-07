"use client";

// The one entry point a driver screen uses for an action that must not be
// lost. Everything mechanical lives in ./actionQueue.ts (and is tested there,
// with no browser); this file is the wiring to the real API, the real
// IndexedDB store, and the listeners the header badge subscribes to.

import { authedFetch } from "./authClient";
import { uploadFile, type MediaPurpose } from "./uploadFile";
import {
  QUEUED_MEDIA,
  canQueue,
  flushQueue,
  indexedDbStore,
  isConnectivityFailure,
  substitute,
  type FlushResult,
  type QueuedAction,
  type QueuedBlob
} from "./actionQueue";

const listeners = new Set<(pending: number) => void>();

async function announce(): Promise<void> {
  if (!canQueue()) return;
  const pending = (await indexedDbStore.all()).length;
  for (const listener of listeners) listener(pending);
}

/** The header badge subscribes; every enqueue and every flush publishes. A
 * queue that drains invisibly is indistinguishable from one that dropped
 * everything. */
export function onQueueChange(listener: (pending: number) => void): () => void {
  listeners.add(listener);
  void announce();
  return () => {
    listeners.delete(listener);
  };
}

const ports = {
  store: indexedDbStore,
  send: (path: string, body: Record<string, unknown>) =>
    authedFetch<unknown>(path, { method: "POST", body: JSON.stringify(body) }).then(() => undefined),
  upload: (blob: QueuedBlob) =>
    uploadFile(new File([blob.data], blob.fileName, { type: blob.contentType }), "pod_photo"),
  isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine)
};

export async function flush(): Promise<FlushResult> {
  if (!canQueue()) return { sent: 0, pending: 0, discarded: 0 };
  const result = await flushQueue(ports);
  await announce();
  return result;
}

export interface SendOptions {
  /** The endpoint's own idempotency key. Without one the action is not
   * queueable, because replaying it is not provably safe. */
  clientActionId: string;
  /** Bytes that must reach the server before the action that names them.
   * The body should carry `QUEUED_MEDIA` wherever the media id belongs. */
  photo?: { file: File; purpose: MediaPurpose };
}

export type SendOutcome = "sent" | "queued";

/**
 * Send an action, or keep it until the signal comes back.
 *
 * The rule that makes this safe: **only a transport failure is queued.** A 409,
 * a 422 or an OTP mismatch is the server having considered the action and said
 * no — that is an answer, it is thrown, and the driver sees it now rather than
 * being told it will sync and finding out at the end of the shift that it
 * never could.
 */
export async function sendOrQueue(
  path: string,
  body: Record<string, unknown>,
  options: SendOptions
): Promise<SendOutcome> {
  // The photo goes first when there is a connection, so the common case
  // queues nothing and behaves exactly as it did before.
  let resolvedBody = body;
  let heldBlob: QueuedBlob | undefined;

  if (options.photo) {
    try {
      const mediaId = await uploadFile(options.photo.file, options.photo.purpose);
      resolvedBody = substitute(body, QUEUED_MEDIA, mediaId);
    } catch (error) {
      if (!isConnectivityFailure(error) || !canQueue()) throw error;
      heldBlob = {
        placeholder: QUEUED_MEDIA,
        data: options.photo.file,
        fileName: options.photo.file.name,
        contentType: options.photo.file.type
      };
    }
  }

  if (!heldBlob) {
    try {
      await ports.send(path, resolvedBody);
      // A successful action is also the best moment to drain anything that
      // queued earlier: the connection is demonstrably back.
      void flush();
      return "sent";
    } catch (error) {
      if (!isConnectivityFailure(error) || !canQueue()) throw error;
    }
  }

  const action: QueuedAction = {
    id: options.clientActionId,
    path,
    body: resolvedBody,
    queuedAt: Date.now(),
    attempts: 0,
    ...(heldBlob ? { blob: heldBlob } : {})
  };
  await indexedDbStore.put(action);
  await announce();
  return "queued";
}

/** Drain on reconnect and once on load. Returns an unsubscribe so a component
 * that mounts it can take it down again. */
export function watchConnection(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onOnline = () => void flush();
  window.addEventListener("online", onOnline);
  void flush();
  return () => window.removeEventListener("online", onOnline);
}
