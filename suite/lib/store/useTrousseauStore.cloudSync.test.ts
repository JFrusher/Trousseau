import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  get: async () => undefined,
  set: async () => undefined,
  del: async () => undefined,
}));

const pushDocumentMock = vi.fn();
const fetchCloudDocumentMock = vi.fn();
vi.mock("@/lib/documents/cloudSync", () => ({
  fetchCloudDocument: (...args: unknown[]) => fetchCloudDocumentMock(...args),
  pushDocument: (...args: unknown[]) => pushDocumentMock(...args),
  replayPendingWrite: async () => null,
}));

const { useTrousseauStore, flushPersist } = await import("./useTrousseauStore");
const { emptyTrousseau } = await import("@jfrusher/trousseau");
const { fingerprintAllSlices } = await import("@/lib/documents/mergeCloudDocument");

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
  const doc = emptyTrousseau();
  useTrousseauStore.setState({
    status: "ready",
    error: null,
    raw: doc as unknown as Record<string, unknown>,
    doc,
    past: [],
    future: [],
    cloudStatus: "disabled",
    cloudVersion: null,
    cloudConflicts: [],
    cloudAgreed: {},
    cloudError: null,
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

test("startCloudSync does not push an empty wedding on first sign-in", async () => {
  // Nothing to lose here, and pushing an empty document would still be
  // correct -- but skipping it is one fewer network round trip for the
  // overwhelmingly common case of a brand-new account.
  fetchCloudDocumentMock.mockResolvedValue({ ok: true, document: null, version: 0 });

  await useTrousseauStore.getState().startCloudSync();

  expect(pushDocumentMock).not.toHaveBeenCalled();
  expect(useTrousseauStore.getState().cloudStatus).toBe("idle");
});
