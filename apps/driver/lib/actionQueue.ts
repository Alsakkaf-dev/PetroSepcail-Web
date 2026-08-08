"use client";

// The driver's offline write queue (DL-03/DL-05, the "a POD, ping or
// transition is never lost" rule).
//
// A driver spends a shift in basements and industrial estates. Until now the
// app's answer to no signal was an error toast and a lost proof of delivery:
// the photo was taken, the customer signed for it, and the record went
// nowhere. `SyncQueueBadge` has existed in the component library since Phase 2
// and nothing ever produced a number for it.
//
// **Why this is safe to replay.** Every endpoint it queues already takes a
// `clientActionId` (`EP-DL-020` transition, `EP-DL-030` pings, `EP-DL-040`
// POD, `EP-DL-060` fail) and the server treats a repeat as the same action —
// so a flush that half-succeeds and runs again does not double-deliver, and a
// driver who taps twice on a flaky connection does not create two records.
// That id is also this queue's primary key, so enqueueing the same action
// twice is one row, not two.
//
// **What it deliberately does not queue.** Accept and decline carry no
// idempotency key, so replaying one is not provably safe; a read is never
// queued, because a stale answer is worse than no answer. Anything not on the
// list below fails loudly, exactly as it does today.
//
// The storage port is an interface rather than a direct IndexedDB call so the
// queue's own logic — ordering, deduplication, attempt counting, what counts
// as a connectivity failure — is testable in plain vitest with no browser.

/** A file that has to reach the server before the action that references it.
 *
 * A POD is a photo plus a code. Queuing the JSON and dropping the bytes would
 * queue half a proof, so the bytes are held too and uploaded on flush, with
 * the resulting media id substituted into the body at that moment. */
export interface QueuedBlob {
  placeholder: string;
  data: Blob;
  fileName: string;
  contentType: string;
}

export interface QueuedAction {
  /** The `clientActionId` the endpoint already accepts. Primary key. */
  id: string;
  path: string;
  /** The request body with `blob.placeholder` standing in for any media id
   * that could not be obtained offline. */
  body: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
  blob?: QueuedBlob;
}

/** Durable storage, abstracted so the queue can be tested without a browser. */
export interface QueueStore {
  all(): Promise<QueuedAction[]>;
  put(action: QueuedAction): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What the queue needs from the outside world, injected for the same reason. */
export interface QueuePorts {
  store: QueueStore;
  /** Sends the action. Rejects with a connectivity failure or a real answer. */
  send: (path: string, body: Record<string, unknown>) => Promise<void>;
  /** Uploads held bytes and returns the media id. */
  upload: (blob: QueuedBlob) => Promise<string>;
  /** Whether the device believes it is online. */
  isOnline: () => boolean;
}

/** Transport failure, not an answer.
 *
 * The distinction is the whole design. A 409 means the server considered the
 * action and rejected it — replaying that forever is a queue that never
 * drains and a driver who is never told. A dropped connection means the
 * server never saw it, and that is the only case worth keeping.
 *
 * `SESSION_EXPIRED` belongs on this side of the line too, even though the
 * server did answer: a 401 from a stale access token is a statement about
 * the *credential*, not about whether the delivery happened. Treating it as
 * a final rejection would silently discard a real POD/transition the moment
 * a driver's token expired mid-shift — the exact "particular care" failure
 * mode a device swap creates. It stays queued and retries once
 * `authClient.ts` gets the driver signed back in. */
export function isConnectivityFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === "NETWORK_UNREACHABLE" ||
    message === "Failed to fetch" ||
    message === "Load failed" ||
    message === "SESSION_EXPIRED" ||
    /networkerror|network request failed/i.test(message)
  );
}

/** Give up on an action after this many flush attempts.
 *
 * Not zero, because a bad tunnel deserves several tries. Not unbounded,
 * because an action the server will never accept must eventually stop being
 * retried and start being visible as a problem — a queue that grows all shift
 * is a queue nobody trusts. */
export const MAX_ATTEMPTS = 8;

export interface FlushResult {
  sent: number;
  /** Still queued: either connectivity is still down, or the attempt budget
   * has not run out yet. */
  pending: number;
  /** Dropped after `MAX_ATTEMPTS`, or rejected by the server on its merits. */
  discarded: number;
}

/** Oldest first. A driver's actions are a sequence — arrived, then delivered —
 * and replaying them out of order asks the server to accept a proof of
 * delivery for a task that has not been marked arrived. */
export function order(actions: QueuedAction[]): QueuedAction[] {
  return [...actions].sort((a, b) => a.queuedAt - b.queuedAt || a.id.localeCompare(b.id));
}

/**
 * Drain the queue.
 *
 * Stops at the first connectivity failure rather than working through the
 * rest: if one request could not leave the device, none of the others will
 * either, and hammering a dead connection costs battery on a phone that has
 * to last a shift.
 */
export async function flushQueue(ports: QueuePorts): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, pending: 0, discarded: 0 };
  const queued = order(await ports.store.all());
  if (queued.length === 0) return result;
  if (!ports.isOnline()) {
    result.pending = queued.length;
    return result;
  }

  for (let index = 0; index < queued.length; index += 1) {
    const action = queued[index]!;
    try {
      let body = action.body;
      if (action.blob) {
        // The bytes go first. If this fails on connectivity the whole action
        // stays queued, photo included, and is retried whole.
        const mediaId = await ports.upload(action.blob);
        body = substitute(action.body, action.blob.placeholder, mediaId);
      }
      await ports.send(action.path, body);
      await ports.store.remove(action.id);
      result.sent += 1;
    } catch (error) {
      if (!isConnectivityFailure(error)) {
        // The server answered and said no. Replaying that forever would be a
        // queue that never drains; it is dropped, and the count going down
        // without the action landing is what the driver sees.
        await ports.store.remove(action.id);
        result.discarded += 1;
        continue;
      }
      const attempts = action.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await ports.store.remove(action.id);
        result.discarded += 1;
        continue;
      }
      await ports.store.put({ ...action, attempts });
      // Everything after this one is untried and still queued.
      result.pending = queued.length - index;
      return result;
    }
  }
  return result;
}

/** Replace a placeholder media id anywhere in the body, at any depth —
 * including *inside* a string.
 *
 * The substring case is not hypothetical: `EP-DL-060` has no media field, so
 * the exception screen carries the photo's id inside its note (item 26). A
 * whole-value-only replacement would have left the placeholder sitting in a
 * note an operator later reads. */
export function substitute(body: Record<string, unknown>, placeholder: string, value: string): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return node.split(placeholder).join(value);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };
  return walk(body) as Record<string, unknown>;
}

/** The placeholder a queued POD carries in place of a media id it could not
 * obtain. Deliberately not a plausible id: if it ever reached the server it
 * would be rejected as malformed rather than silently attached to somebody
 * else's photo. */
export const QUEUED_MEDIA = "__ps-queued-media__";

// ---------------------------------------------------------------------------
// The browser implementation of the port.
// ---------------------------------------------------------------------------

const DB_PREFIX = "ps-driver-queue";
const DB_VERSION = 1;
const STORE = "actions";
// Same key apps/driver/lib/authClient.ts persists the bearer token under —
// duplicated as a literal rather than imported, so this file's only
// dependency stays the browser (indexedDB, localStorage), matching its own
// "storage port is an interface" design and keeping the pure queue logic
// above independently testable with no browser.
const TOKEN_KEY = "ps-driver-token";

/** The JWT's own `driver_id` claim, read without verifying the signature —
 * this is a client-side storage key, not a security decision (every real
 * check happens server-side against the verified token on each request).
 * Pure and browser-free on purpose (takes the raw token, never touches
 * `window`) so it stays testable in plain vitest alongside the rest of this
 * file's logic — only its caller, `currentDriverKey()`, is the browser glue.
 *
 * A device handed from one driver to another mid-shift must not let the
 * queue bleed between them: driver A's unflushed POD/transition, replayed
 * under driver B's identity because they happen to share a browser, is
 * exactly the "particular care" failure mode the brief calls out by name.
 * Giving each driver their own IndexedDB database (not just their own rows
 * in a shared one) makes that structurally impossible rather than a rule
 * the rest of this file has to remember to enforce. */
export function driverIdFromToken(token: string | null | undefined): string {
  try {
    const payload = token?.split(".")[1];
    if (!payload) return "anonymous";
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = JSON.parse(atob(base64)) as { driver_id?: unknown };
    return typeof claims.driver_id === "string" && claims.driver_id ? claims.driver_id : "anonymous";
  } catch {
    return "anonymous";
  }
}

function currentDriverKey(): string {
  if (typeof window === "undefined") return "anonymous";
  return driverIdFromToken(window.localStorage.getItem(TOKEN_KEY));
}

function openDb(): Promise<IDBDatabase> {
  const dbName = `${DB_PREFIX}-${currentDriverKey()}`;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb open failed"));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
        tx.oncomplete = () => db.close();
      })
  );
}

/** IndexedDB rather than localStorage, for two reasons that both matter here:
 * it stores a Blob (a POD photo is megabytes, and localStorage is strings
 * capped around 5MB), and it survives the tab being killed mid-shift. */
export const indexedDbStore: QueueStore = {
  all: () => run<QueuedAction[]>("readonly", (store) => store.getAll() as IDBRequest<QueuedAction[]>),
  put: (action) => run("readwrite", (store) => store.put(action)).then(() => undefined),
  remove: (id) => run("readwrite", (store) => store.delete(id)).then(() => undefined)
};

/** True when this device can hold a queue at all. A browser without
 * IndexedDB — a locked-down kiosk, a private window in an old Safari — gets
 * the old behaviour: the action fails loudly rather than being promised a
 * sync that cannot happen. */
export function canQueue(): boolean {
  return typeof indexedDB !== "undefined";
}
