import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findOpenIncident = vi.fn();
const openIncident = vi.fn();
const resolveIncident = vi.fn();
const withServiceRoleTransaction = vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({}));

vi.mock("@petrospecial/observability", () => ({
  findOpenIncident: (...args: unknown[]) => findOpenIncident(...args),
  openIncident: (...args: unknown[]) => openIncident(...args),
  resolveIncident: (...args: unknown[]) => resolveIncident(...args)
}));

vi.mock("./db.js", () => ({
  withServiceRoleTransaction: (...args: unknown[]) => withServiceRoleTransaction(args[0] as never)
}));

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

const { createHealthWatcher, FAILURE_THRESHOLD } = await import("./healthWatcher.js");

describe("createHealthWatcher", () => {
  const target = { service: "api", url: "http://api:4000/api/v1/ready" };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    findOpenIncident.mockReset();
    openIncident.mockReset();
    resolveIncident.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when the target is healthy and was never failing", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const watcher = createHealthWatcher([target]);
    await watcher.pollOnce();
    expect(openIncident).not.toHaveBeenCalled();
    expect(resolveIncident).not.toHaveBeenCalled();
  });

  it("does not open an incident below the failure threshold", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const watcher = createHealthWatcher([target]);
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      await watcher.pollOnce();
    }
    expect(openIncident).not.toHaveBeenCalled();
  });

  it("opens an S1 incident once the failure threshold is reached", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    findOpenIncident.mockResolvedValue(null);
    openIncident.mockResolvedValue(1);
    const watcher = createHealthWatcher([target]);
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await watcher.pollOnce();
    }
    expect(openIncident).toHaveBeenCalledTimes(1);
    expect(openIncident).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ severity: "S1", service: "api" }));
  });

  it("does not open a duplicate incident while one is already open", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    findOpenIncident.mockResolvedValue({ id: 99 });
    const watcher = createHealthWatcher([target]);
    for (let i = 0; i < FAILURE_THRESHOLD + 2; i++) {
      await watcher.pollOnce();
    }
    expect(openIncident).not.toHaveBeenCalled();
  });

  it("resolves the open incident once the target recovers", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: false });
    findOpenIncident.mockResolvedValue(null);
    openIncident.mockResolvedValue(5);
    const watcher = createHealthWatcher([target]);
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await watcher.pollOnce();
    }

    fetchMock.mockResolvedValue({ ok: true });
    findOpenIncident.mockResolvedValue({ id: 5 });
    await watcher.pollOnce();

    expect(resolveIncident).toHaveBeenCalledWith(expect.anything(), 5);
  });

  it("treats a fetch rejection as a failed check", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    findOpenIncident.mockResolvedValue(null);
    openIncident.mockResolvedValue(2);
    const watcher = createHealthWatcher([target]);
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await watcher.pollOnce();
    }
    expect(openIncident).toHaveBeenCalledTimes(1);
  });
});
