import { beforeEach, expect, test, vi } from "vitest";

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

const { useTrousseauStore } = await import("./useTrousseauStore");
const { emptyTrousseau } = await import("@jfrusher/trousseau");

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
    cloudConflict: null,
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
});

test("a rejected write surfaces as a conflict, not an auto-merge", async () => {
  useTrousseauStore.setState({ cloudStatus: "idle", cloudVersion: 1 });
  pushDocumentMock.mockResolvedValue({
    ok: false,
    reason: "conflict",
    version: 2,
    document: { event: { coupleNames: "theirs" } },
  });
  await useTrousseauStore.getState().syncToCloud();
  const state = useTrousseauStore.getState();
  expect(state.cloudStatus).toBe("conflict");
  expect(state.cloudConflict).toEqual({
    document: { event: { coupleNames: "theirs" } },
    version: 2,
  });
});

test("resolveConflictTakeTheirs adopts the cloud document and clears the conflict", () => {
  useTrousseauStore.setState({
    cloudStatus: "conflict",
    cloudConflict: { document: emptyTrousseau(), version: 7 },
  });
  useTrousseauStore.getState().resolveConflictTakeTheirs();
  const state = useTrousseauStore.getState();
  expect(state.cloudConflict).toBeNull();
  expect(state.cloudVersion).toBe(7);
  expect(state.cloudStatus).toBe("idle");
});

test("syncToCloud does nothing at all while cloud sync is disabled", async () => {
  await useTrousseauStore.getState().syncToCloud();
  expect(pushDocumentMock).not.toHaveBeenCalled();
  expect(useTrousseauStore.getState().cloudStatus).toBe("disabled");
});
