import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  get: async () => undefined,
  set: async () => undefined,
  del: async () => undefined,
}));

const pushDocumentMock = vi.fn();
const fetchCloudDocumentMock = vi.fn();
const fetchWeddingIdMock = vi.fn();
vi.mock("@/lib/documents/cloudSync", () => ({
  fetchCloudDocument: (...args: unknown[]) => fetchCloudDocumentMock(...args),
  pushDocument: (...args: unknown[]) => pushDocumentMock(...args),
  replayPendingWrite: async () => null,
  getPendingWrite: async () => null,
  fetchWeddingId: (...args: unknown[]) => fetchWeddingIdMock(...args),
}));

// Mocked rather than left to run: the real module reaches for browserClient
// and IndexedDB, and *when* it is called is the assertion in two tests below.
const syncAssetsMock = vi.fn(async (_weddingId: string) => ({ uploaded: 0, downloaded: 0 }));
vi.mock("@/lib/documents/assets", () => ({
  syncAssets: (weddingId: string) => syncAssetsMock(weddingId),
}));

const { useTrousseauStore, flushPersist } = await import("./useTrousseauStore");
const { emptyTrousseau } = await import("@jfrusher/trousseau");
const { fingerprintAllSlices } = await import("@/lib/documents/mergeCloudDocument");
const { fingerprint } = await import("@/lib/documents/fingerprint");

/** Long enough for the 250ms persist timer, and the push it ends in, to run. */
const PAST_THE_PERSIST_DELAY_MS = 400;
const settle = () => new Promise((resolve) => setTimeout(resolve, PAST_THE_PERSIST_DELAY_MS));

// resolveConflict and replaceDocument both schedule a real, un-awaited
// persist timer. Left pending, it fires mid-way through a later test with
// whatever mock the *next* test happened to configure - flushing it here
// cancels that timer before it can fire against a stale mock.
afterEach(async () => {
  await flushPersist();
});

beforeEach(() => {
  pushDocumentMock.mockReset();
  fetchCloudDocumentMock.mockReset();
  syncAssetsMock.mockClear();
  fetchWeddingIdMock.mockReset();
  // No wedding id by default: keeps the asset sync a no-op except in the two
  // tests that ask about it.
  fetchWeddingIdMock.mockResolvedValue({ ok: true, weddingId: null });
  const doc = emptyTrousseau();
  useTrousseauStore.setState({
    status: "ready",
    error: null,
    generation: 0,
    raw: doc as unknown as Record<string, unknown>,
    doc,
    past: [],
    future: [],
    cloudStatus: "disabled",
    cloudVersion: null,
    cloudConflicts: [],
    cloudAgreed: {},
    cloudError: null,
    weddingId: null,
  });
});

test("startCloudSync stays disabled when the cloud reports unavailable", async () => {
  fetchCloudDocumentMock.mockResolvedValue({ ok: false, reason: "unavailable" });
  await useTrousseauStore.getState().startCloudSync();
  expect(useTrousseauStore.getState().cloudStatus).toBe("disabled");
});

test("startCloudSync adopts the cloud document without creating an undo entry", async () => {
  fetchCloudDocumentMock.mockResolvedValue({ ok: true, document: emptyTrousseau(), version: 4 });
  await useTrousseauStore.getState().startCloudSync();
  const state = useTrousseauStore.getState();
  expect(state.cloudStatus).toBe("idle");
  expect(state.cloudVersion).toBe(4);
  expect(state.past).toEqual([]);
  expect(Object.keys(state.cloudAgreed).length).toBeGreaterThan(0);
});

test("a rejected write surfaces per-slice conflicts, not an auto-merge", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: { ...base, event: { coupleNames: "mine" } },
  });
  pushDocumentMock.mockResolvedValue({
    ok: false,
    reason: "conflict",
    version: 2,
    document: { ...base, event: { coupleNames: "theirs" } },
  });
  await useTrousseauStore.getState().syncToCloud();
  const state = useTrousseauStore.getState();
  expect(state.cloudStatus).toBe("conflict");
  expect(state.cloudConflicts).toEqual([{ slice: "event", theirs: { coupleNames: "theirs" } }]);
  // The conflicting slice keeps the local value until resolved.
  expect((state.raw as Record<string, unknown>).event).toEqual({ coupleNames: "mine" });
});

test("a rejected write with no actual slice overlap resolves itself and re-pushes", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: { ...base, guests: { g1: { id: "g1" } } },
  });
  pushDocumentMock
    .mockResolvedValueOnce({
      ok: false,
      reason: "conflict",
      version: 2,
      document: { ...base, seating: { t1: { id: "t1" } } },
    })
    .mockResolvedValueOnce({ ok: true, version: 3, warnings: [] });

  await useTrousseauStore.getState().syncToCloud();

  const state = useTrousseauStore.getState();
  expect(state.cloudConflicts).toEqual([]);
  expect(state.cloudStatus).toBe("idle");
  expect(state.cloudVersion).toBe(3);
  expect((state.raw as Record<string, unknown>).guests).toEqual({ g1: { id: "g1" } });
  expect((state.raw as Record<string, unknown>).seating).toEqual({ t1: { id: "t1" } });
  expect(pushDocumentMock).toHaveBeenCalledTimes(2);
});

test("resolveConflict(theirs) applies the server's slice and clears that conflict", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "conflict",
    cloudVersion: 2,
    cloudAgreed: fingerprintAllSlices(base),
    cloudConflicts: [{ slice: "event", theirs: { coupleNames: "theirs" } }],
    raw: { ...base, event: { coupleNames: "mine" } },
  });

  useTrousseauStore.getState().resolveConflict("event", "theirs");

  const state = useTrousseauStore.getState();
  expect(state.cloudConflicts).toEqual([]);
  expect((state.raw as Record<string, unknown>).event).toEqual({ coupleNames: "theirs" });
});

test("resolveConflict(mine) drops the conflict and keeps the local slice", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "conflict",
    cloudVersion: 2,
    cloudAgreed: fingerprintAllSlices(base),
    cloudConflicts: [{ slice: "event", theirs: { coupleNames: "theirs" } }],
    raw: { ...base, event: { coupleNames: "mine" } },
  });

  useTrousseauStore.getState().resolveConflict("event", "mine");

  const state = useTrousseauStore.getState();
  expect(state.cloudConflicts).toEqual([]);
  expect((state.raw as Record<string, unknown>).event).toEqual({ coupleNames: "mine" });
});

test("pullFromCloud takes a slice that only changed on the server", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: base,
  });
  fetchCloudDocumentMock.mockResolvedValue({
    ok: true,
    document: { ...base, guests: { g1: { id: "g1" } } },
    version: 2,
  });
  // A clean pull with nothing left in conflict re-pushes to confirm the
  // merge (fire-and-forget, see pullFromCloud) - same version back, so the
  // assertion below holds regardless of whether that push lands before it.
  pushDocumentMock.mockResolvedValue({ ok: true, version: 2, warnings: [] });

  await useTrousseauStore.getState().pullFromCloud();

  const state = useTrousseauStore.getState();
  expect((state.raw as Record<string, unknown>).guests).toEqual({ g1: { id: "g1" } });
  expect(state.cloudVersion).toBe(2);
  expect(state.cloudConflicts).toEqual([]);
});

test("pullFromCloud does nothing when the server version hasn't moved", async () => {
  const raw = useTrousseauStore.getState().raw;
  useTrousseauStore.setState({ cloudStatus: "idle", cloudVersion: 5 });
  // fetchCloudDocument has no way to report a version without a round trip,
  // so pullFromCloud always calls it - the "hasn't moved" short-circuit is
  // the version-equality check right after the response comes back.
  fetchCloudDocumentMock.mockResolvedValue({ ok: true, document: raw, version: 5 });
  await useTrousseauStore.getState().pullFromCloud();
  const state = useTrousseauStore.getState();
  expect(state.cloudVersion).toBe(5);
  expect(state.raw).toEqual(raw);
});

test("syncToCloud does nothing at all while cloud sync is disabled", async () => {
  await useTrousseauStore.getState().syncToCloud();
  expect(pushDocumentMock).not.toHaveBeenCalled();
  expect(useTrousseauStore.getState().cloudStatus).toBe("disabled");
});

test("startCloudSync pushes the local wedding up on first sign-in, when the cloud has nothing yet", async () => {
  // The bug this covers: a wedding built entirely offline, then signed into.
  // fetchCloudDocument correctly reports `document: null` -- nothing has ever
  // been saved for this account -- and startCloudSync used to just go idle,
  // leaving the local wedding stranded until the next edit. Exporting from
  // the account page then answered "Nothing has been saved to your account
  // yet.", which was true of the server and false of what the user actually
  // had open.
  const guests = { g1: { id: "g1", firstName: "Charis" } };
  useTrousseauStore.setState((state) => ({
    raw: { ...state.raw, guests },
    doc: { ...state.doc, guests } as never,
  }));

  fetchCloudDocumentMock.mockResolvedValue({ ok: true, document: null, version: 0 });
  pushDocumentMock.mockResolvedValue({ ok: true, version: 1, warnings: [] });

  await useTrousseauStore.getState().startCloudSync();

  expect(pushDocumentMock).toHaveBeenCalledWith(
    expect.objectContaining({ guests }),
    0,
  );
  expect(useTrousseauStore.getState().cloudStatus).toBe("idle");
  expect(useTrousseauStore.getState().cloudVersion).toBe(1);
  expect(Object.keys(useTrousseauStore.getState().cloudAgreed).length).toBeGreaterThan(0);
});

/**
 * The one test that crosses every task boundary this feature was built
 * across: the store's conflict handling, `schedulePersist`'s real 250ms
 * timer, and `toolGeneration`'s remount signal.
 *
 * Deliberately on real timers. Both bugs it covers lived *in* the timer:
 * every existing test either flushed it away or never reached it, so a
 * conflict that quietly resolved itself as "keep mine" a quarter of a second
 * after being surfaced went unnoticed through seven task reviews.
 */
test("a surfaced conflict pushes nothing until it is resolved, then pushes the resolved value", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: { ...base, event: { coupleNames: "mine" } },
  });
  pushDocumentMock.mockResolvedValue({
    ok: false,
    reason: "conflict",
    version: 2,
    document: { ...base, event: { coupleNames: "theirs" } },
  });

  await useTrousseauStore.getState().syncToCloud();
  expect(useTrousseauStore.getState().cloudStatus).toBe("conflict");
  expect(pushDocumentMock).toHaveBeenCalledTimes(1);

  // The conflict path calls replaceDocument, which schedules a persist, which
  // ends in a push. Let it run.
  await settle();

  expect(pushDocumentMock).toHaveBeenCalledTimes(1);
  expect(useTrousseauStore.getState().cloudStatus).toBe("conflict");
  expect(useTrousseauStore.getState().cloudConflicts).toEqual([
    { slice: "event", theirs: { coupleNames: "theirs" } },
  ]);
  expect((useTrousseauStore.getState().raw as Record<string, unknown>).event).toEqual({
    coupleNames: "mine",
  });

  const generationBefore = useTrousseauStore.getState().generation;
  pushDocumentMock.mockResolvedValue({ ok: true, version: 3, warnings: [] });
  useTrousseauStore.getState().resolveConflict("event", "theirs");

  // A tool mounted before the resolution holds the pre-resolution slice;
  // without a new generation its next autosave writes that value back over
  // the user's choice and pushes the revert.
  expect(useTrousseauStore.getState().generation).toBe(generationBefore + 1);

  await settle();

  expect(pushDocumentMock).toHaveBeenCalledTimes(2);
  expect(pushDocumentMock.mock.calls[1][0]).toMatchObject({
    event: { coupleNames: "theirs" },
  });
  expect(useTrousseauStore.getState().cloudStatus).toBe("idle");
});

test("pullFromCloud waits for a baseline instead of merging against an empty one", async () => {
  // Where startCloudSync leaves things when its first fetch was unreachable.
  // With nothing agreed, every slice reads as changed-on-both-sides.
  useTrousseauStore.setState({ cloudStatus: "error", cloudVersion: null, cloudAgreed: {} });

  await useTrousseauStore.getState().pullFromCloud();

  expect(fetchCloudDocumentMock).not.toHaveBeenCalled();
  expect(useTrousseauStore.getState().cloudConflicts).toEqual([]);
});

test("pullFromCloud merges against the document as it is when the fetch lands", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: base,
  });
  fetchCloudDocumentMock.mockImplementation(async () => {
    // The user types while the request is in flight. Merging against the
    // snapshot taken before the fetch discards this, and then pushes the
    // discard.
    useTrousseauStore.setState({
      raw: { ...useTrousseauStore.getState().raw, event: { coupleNames: "typed mid-fetch" } },
    });
    return { ok: true, document: { ...base, guests: { g1: { id: "g1" } } }, version: 2 };
  });
  pushDocumentMock.mockResolvedValue({ ok: true, version: 3, warnings: [] });

  await useTrousseauStore.getState().pullFromCloud();

  const raw = useTrousseauStore.getState().raw as Record<string, unknown>;
  expect(raw.event).toEqual({ coupleNames: "typed mid-fetch" });
  expect(raw.guests).toEqual({ g1: { id: "g1" } });
});

test("a pull that brings back nothing new neither replaces the document nor pushes", async () => {
  // Two tabs open: this is our own write coming back at a moved version.
  // Replacing anyway remounts every tool (generation), and pushing it back is
  // what made the two tabs bounce the document between them forever.
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: base,
    generation: 3,
  });
  fetchCloudDocumentMock.mockResolvedValue({ ok: true, document: base, version: 2 });

  await useTrousseauStore.getState().pullFromCloud();

  expect(pushDocumentMock).not.toHaveBeenCalled();
  expect(useTrousseauStore.getState().generation).toBe(3);
  expect(useTrousseauStore.getState().cloudVersion).toBe(2);
});

test("a successful push records agreement on what was pushed, not on a later edit", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: { ...base, event: { coupleNames: "pushed" } },
  });
  pushDocumentMock.mockImplementation(async () => {
    // Typed while the push is in flight — the server never saw this.
    useTrousseauStore.setState({
      raw: { ...useTrousseauStore.getState().raw, event: { coupleNames: "typed during the push" } },
    });
    return { ok: true, version: 2, warnings: [] };
  });

  await useTrousseauStore.getState().syncToCloud();

  // Recording the newer value as agreed would make the next merge read this
  // slice as unchanged here, and silently take the partner's value over it.
  expect(useTrousseauStore.getState().cloudAgreed.event).toBe(
    fingerprint({ coupleNames: "pushed" }),
  );
});

test("assets sync on a pull, not on every document push", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: base,
    weddingId: "w1",
  });
  pushDocumentMock.mockResolvedValue({ ok: true, version: 2, warnings: [] });

  // A push happens after every debounced edit burst. Fonts and artwork only
  // change on upload, so listing the bucket and reading every blob out of
  // IndexedDB here costs a round trip per keystroke burst for nothing.
  await useTrousseauStore.getState().syncToCloud();
  expect(syncAssetsMock).not.toHaveBeenCalled();

  fetchCloudDocumentMock.mockResolvedValue({
    ok: true,
    document: { ...base, guests: { g1: { id: "g1" } } },
    version: 3,
  });
  await useTrousseauStore.getState().pullFromCloud();
  expect(syncAssetsMock).toHaveBeenCalledWith("w1");
});

test("pullFromCloud resolves a wedding id startCloudSync could not", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: base,
    weddingId: null,
  });
  fetchCloudDocumentMock.mockResolvedValue({ ok: true, document: base, version: 2 });
  fetchWeddingIdMock.mockResolvedValue({ ok: true, weddingId: "w2" });

  await useTrousseauStore.getState().pullFromCloud();

  expect(useTrousseauStore.getState().weddingId).toBe("w2");
  expect(syncAssetsMock).toHaveBeenCalledWith("w2");
});

test("startCloudSync does not push an empty wedding on first sign-in", async () => {
  // Nothing to lose here, and pushing an empty document would still be
  // correct -- but skipping it is one fewer network round trip for the
  // overwhelmingly common case of a brand-new account.
  fetchCloudDocumentMock.mockResolvedValue({ ok: true, document: null, version: 0 });

  await useTrousseauStore.getState().startCloudSync();

  expect(pushDocumentMock).not.toHaveBeenCalled();
  expect(useTrousseauStore.getState().cloudStatus).toBe("idle");
});
