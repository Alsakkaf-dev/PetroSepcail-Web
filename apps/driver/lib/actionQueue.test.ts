import { describe, expect, it, vi } from "vitest";
import {
  MAX_ATTEMPTS,
  QUEUED_MEDIA,
  flushQueue,
  isConnectivityFailure,
  order,
  substitute,
  type QueuePorts,
  type QueueStore,
  type QueuedAction
} from "./actionQueue";

// The queue's logic is deliberately separable from IndexedDB so it can be
// tested exactly like this: in plain vitest, with no browser, no fake-indexeddb
// dependency and no jsdom. Everything a driver depends on offline — ordering,
// what gets retried, what gets dropped, whether a photo survives — is decided
// in these functions.

function memoryStore(seed: QueuedAction[] = []): QueueStore & { rows: Map<string, QueuedAction> } {
  const rows = new Map(seed.map((action) => [action.id, action]));
  return {
    rows,
    all: async () => [...rows.values()],
    put: async (action) => {
      rows.set(action.id, action);
    },
    remove: async (id) => {
      rows.delete(id);
    }
  };
}

function action(id: string, queuedAt: number, extra: Partial<QueuedAction> = {}): QueuedAction {
  return { id, path: `/api/v1/driver/tasks/${id}/transition`, body: { to: "arrived" }, queuedAt, attempts: 0, ...extra };
}

const offline = () => new Error("NETWORK_UNREACHABLE");

describe("what counts as a connectivity failure", () => {
  it("recognises the shapes a dropped connection actually takes", () => {
    expect(isConnectivityFailure(new Error("NETWORK_UNREACHABLE"))).toBe(true);
    expect(isConnectivityFailure(new Error("Failed to fetch"))).toBe(true);
    expect(isConnectivityFailure(new Error("Load failed"))).toBe(true);
    expect(isConnectivityFailure(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
  });

  it("does not mistake an answer for a dropped connection", () => {
    // The distinction the whole design rests on: the server considered these
    // and said no. Replaying them forever is a queue that never drains.
    expect(isConnectivityFailure(new Error("OTP_MISMATCH"))).toBe(false);
    expect(isConnectivityFailure(new Error("CONFLICT"))).toBe(false);
    expect(isConnectivityFailure(new Error("TASK_NOT_ASSIGNED"))).toBe(false);
  });

  it("treats a stale access token as retriable, not a rejection", () => {
    // A 401 here is a statement about the credential, not about whether the
    // delivery happened — discarding it the way OTP_MISMATCH/CONFLICT are
    // discarded would silently drop a real POD the moment a driver's token
    // expired mid-shift.
    expect(isConnectivityFailure(new Error("SESSION_EXPIRED"))).toBe(true);
  });
});

describe("ordering", () => {
  it("replays oldest first, because a driver's actions are a sequence", () => {
    // Arrived, then delivered. The other order asks the server to accept a
    // proof of delivery for a task that was never marked arrived.
    const sorted = order([action("c", 300), action("a", 100), action("b", 200)]);
    expect(sorted.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("is stable when two actions share a timestamp", () => {
    const sorted = order([action("b", 100), action("a", 100)]);
    expect(sorted.map((a) => a.id)).toEqual(["a", "b"]);
  });
});

describe("flushing", () => {
  function ports(store: QueueStore, overrides: Partial<QueuePorts> = {}): QueuePorts {
    return {
      store,
      send: vi.fn(async () => undefined),
      upload: vi.fn(async () => "media-1"),
      isOnline: () => true,
      ...overrides
    };
  }

  it("sends everything and empties the queue", async () => {
    const store = memoryStore([action("a", 1), action("b", 2)]);
    const result = await flushQueue(ports(store));
    expect(result).toEqual({ sent: 2, pending: 0, discarded: 0 });
    expect(store.rows.size).toBe(0);
  });

  it("does nothing at all while the device knows it is offline", async () => {
    const store = memoryStore([action("a", 1)]);
    const send = vi.fn();
    const result = await flushQueue(ports(store, { send, isOnline: () => false }));
    expect(send).not.toHaveBeenCalled();
    expect(result.pending).toBe(1);
    expect(store.rows.size).toBe(1);
  });

  it("stops at the first dropped connection instead of hammering a dead link", async () => {
    // One failure means none of the rest will leave the device either, and a
    // phone has to last a shift.
    const store = memoryStore([action("a", 1), action("b", 2), action("c", 3)]);
    const send = vi.fn(async (path: string) => {
      if (path.includes("/b/")) throw offline();
    });
    const result = await flushQueue(ports(store, { send }));
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(1);
    expect(result.pending).toBe(2);
    expect(store.rows.has("a")).toBe(false);
    expect(store.rows.get("b")?.attempts).toBe(1);
    expect(store.rows.has("c")).toBe(true);
  });

  it("drops an action the server has rejected on its merits", async () => {
    const store = memoryStore([action("a", 1), action("b", 2)]);
    const send = vi.fn(async (path: string) => {
      if (path.includes("/a/")) throw new Error("CONFLICT");
    });
    const result = await flushQueue(ports(store, { send }));
    expect(result).toEqual({ sent: 1, pending: 0, discarded: 1 });
    expect(store.rows.size).toBe(0);
  });

  it("gives up on an action that has been retried to the limit", async () => {
    // A queue that grows all shift is a queue nobody trusts.
    const store = memoryStore([action("a", 1, { attempts: MAX_ATTEMPTS - 1 })]);
    const result = await flushQueue(ports(store, { send: vi.fn(async () => { throw offline(); }) }));
    expect(result.discarded).toBe(1);
    expect(store.rows.size).toBe(0);
  });

  it("uploads a held photo and puts its real id into the body before sending", async () => {
    const store = memoryStore([
      action("pod-1", 1, {
        path: "/api/v1/driver/tasks/pod-1/pod",
        body: { photoMediaId: QUEUED_MEDIA, otp: "1234", clientActionId: "pod-1" },
        blob: {
          placeholder: QUEUED_MEDIA,
          data: new Blob(["bytes"]),
          fileName: "pod.jpg",
          contentType: "image/jpeg"
        }
      })
    ]);
    const send = vi.fn(async () => undefined);
    const upload = vi.fn(async () => "media-real");
    await flushQueue(ports(store, { send, upload }));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("/api/v1/driver/tasks/pod-1/pod", {
      photoMediaId: "media-real",
      otp: "1234",
      clientActionId: "pod-1"
    });
  });

  it("keeps the whole proof — photo included — when the upload cannot leave the device", async () => {
    const store = memoryStore([
      action("pod-1", 1, {
        body: { photoMediaId: QUEUED_MEDIA },
        blob: { placeholder: QUEUED_MEDIA, data: new Blob(["b"]), fileName: "p.jpg", contentType: "image/jpeg" }
      })
    ]);
    const send = vi.fn();
    await flushQueue(ports(store, { send, upload: vi.fn(async () => { throw offline(); }) }));
    expect(send).not.toHaveBeenCalled();
    expect(store.rows.get("pod-1")?.blob).toBeDefined();
  });
});

describe("media substitution", () => {
  it("replaces the placeholder wherever it sits, at any depth", () => {
    const body = { photoMediaId: QUEUED_MEDIA, nested: { list: [QUEUED_MEDIA, "keep"] }, otp: "1234" };
    expect(substitute(body, QUEUED_MEDIA, "media-9")).toEqual({
      photoMediaId: "media-9",
      nested: { list: ["media-9", "keep"] },
      otp: "1234"
    });
  });

  it("replaces the placeholder inside a string, not only as a whole value", () => {
    // EP-DL-060 has no media field, so the exception screen carries the id
    // inside its note. A whole-value-only replacement would have left the
    // placeholder sitting in a note an operator later reads.
    const body = { note: "Shutter closed\nphoto: " + QUEUED_MEDIA, reasonCode: "unreachable" };
    expect(substitute(body, QUEUED_MEDIA, "media-9")).toEqual({
      note: "Shutter closed\nphoto: media-9",
      reasonCode: "unreachable"
    });
  });

  it("leaves a body with no placeholder untouched", () => {
    const body = { to: "arrived", clientActionId: "x" };
    expect(substitute(body, QUEUED_MEDIA, "media-9")).toEqual(body);
  });

  it("uses a placeholder that could never be mistaken for a real media id", () => {
    // If it ever reached the server it would be rejected as malformed rather
    // than silently attached to somebody else's photo.
    expect(QUEUED_MEDIA).not.toMatch(/^[0-9a-f-]{36}$/);
  });
});
