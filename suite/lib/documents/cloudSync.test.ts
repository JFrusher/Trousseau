import { beforeEach, describe, expect, it, vi } from "vitest";

const idbStore = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (key: string) => idbStore.get(key),
  set: async (key: string, value: unknown) => void idbStore.set(key, value),
  del: async (key: string) => void idbStore.delete(key),
}));

const { fetchCloudDocument, pushDocument, getPendingWrite, clearPendingWrite, replayPendingWrite, queueWrite } =
  await import("./cloudSync");

beforeEach(() => {
  idbStore.clear();
  vi.restoreAllMocks();
});

describe("fetchCloudDocument", () => {
  it("returns the document and version on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ document: { event: {} }, version: 3 }), { status: 200 })),
    );
    const result = await fetchCloudDocument();
    expect(result).toEqual({ ok: true, document: { event: {} }, version: 3 });
  });

  it("reports not-reachable on a network failure, without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await fetchCloudDocument();
    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  it("reports unavailable on a 501 (accounts not configured or no wedding yet)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 501 })));
    const result = await fetchCloudDocument();
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("pushDocument", () => {
  it("succeeds and clears any previously queued write", async () => {
    await queueWrite({ event: {} }, 0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ version: 1, warnings: [] }), { status: 200 })),
    );
    const result = await pushDocument({ event: {} }, 0);
    expect(result).toEqual({ ok: true, version: 1, warnings: [] });
    expect(await getPendingWrite()).toBeNull();
  });

  it("queues the write and reports queued when the network is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await pushDocument({ event: { coupleNames: "offline edit" } }, 2);
    expect(result).toEqual({ ok: false, reason: "queued" });
    const pending = await getPendingWrite();
    expect(pending).toEqual({ document: { event: { coupleNames: "offline edit" } }, expectedVersion: 2 });
  });

  it("a second offline write while one is already queued replaces it, not appends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await pushDocument({ event: { coupleNames: "first" } }, 2);
    await pushDocument({ event: { coupleNames: "second" } }, 2);
    const pending = await getPendingWrite();
    expect(pending?.document).toEqual({ event: { coupleNames: "second" } });
  });

  it("surfaces a conflict without treating it as queueable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: 5, document: { event: { coupleNames: "theirs" } } }), {
            status: 409,
          }),
      ),
    );
    const result = await pushDocument({ event: { coupleNames: "mine, but stale" } }, 4);
    expect(result).toEqual({ ok: false, reason: "conflict", version: 5, document: { event: { coupleNames: "theirs" } } });
    expect(await getPendingWrite()).toBeNull();
  });

  it("surfaces a validation failure without queueing it for silent retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "That wedding is not valid.", errors: ["bad"] }), { status: 422 }),
      ),
    );
    const result = await pushDocument({ event: {} }, 0);
    expect(result).toEqual({ ok: false, reason: "invalid", errors: ["bad"] });
    expect(await getPendingWrite()).toBeNull();
  });
});

describe("clearPendingWrite", () => {
  it("removes a queued write", async () => {
    await queueWrite({ event: {} }, 0);
    await clearPendingWrite();
    expect(await getPendingWrite()).toBeNull();
  });
});

describe("replayPendingWrite", () => {
  it("returns null when nothing is queued", async () => {
    expect(await replayPendingWrite()).toBeNull();
  });

  it("replays a queued write successfully and clears the queue", async () => {
    await queueWrite({ event: { coupleNames: "queued while offline" } }, 3);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ version: 4, warnings: [] }), { status: 200 })),
    );
    const result = await replayPendingWrite();
    expect(result).toEqual({ ok: true, version: 4, warnings: [] });
    expect(await getPendingWrite()).toBeNull();
  });

  it("a queued write that now conflicts on replay surfaces the same conflict shape as an online conflict", async () => {
    await queueWrite({ event: { coupleNames: "queued while offline" } }, 3);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: 6, document: { event: { coupleNames: "someone else's edit" } } }), {
            status: 409,
          }),
      ),
    );
    const result = await replayPendingWrite();
    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      version: 6,
      document: { event: { coupleNames: "someone else's edit" } },
    });
    expect(await getPendingWrite()).toBeNull();
  });
});
