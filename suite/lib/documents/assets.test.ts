// Node, not jsdom: jsdom's `Blob` has no `arrayBuffer`, and the download test
// below needs a real one. Same rationale as lib/sync/migrations.test.ts.
// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";

const listMock = vi.fn();
const uploadMock = vi.fn();
const downloadMock = vi.fn();
vi.mock("@/lib/accounts/browserClient", () => ({
  browserClient: () => ({
    storage: {
      from: () => ({
        list: listMock,
        upload: uploadMock,
        download: downloadMock,
      }),
    },
  }),
}));

const collectAssetsMock = vi.fn();
const heldAssetIdsMock = vi.fn();
const acceptAssetMock = vi.fn();
vi.mock("@/lib/sync/assets", () => ({
  collectAssets: (...args: unknown[]) => collectAssetsMock(...args),
  heldAssetIds: (...args: unknown[]) => heldAssetIdsMock(...args),
  acceptAsset: (...args: unknown[]) => acceptAssetMock(...args),
}));

const { syncAssets } = await import("./assets");

// The three mocks above are module-scoped `vi.fn()`s shared across every
// test in this file; without a reset, one test's calls stay recorded when
// the next test asserts `.not.toHaveBeenCalled()`.
beforeEach(() => {
  vi.clearAllMocks();
});

test("uploads a locally-held asset the server does not have yet", async () => {
  listMock.mockResolvedValue({ data: [], error: null });
  collectAssetsMock.mockResolvedValue([{ id: "font-a1", bytes: new Uint8Array([1, 2, 3]) }]);
  heldAssetIdsMock.mockResolvedValue(["font-a1"]);
  uploadMock.mockResolvedValue({ error: null });

  const result = await syncAssets("wedding-1");

  expect(uploadMock).toHaveBeenCalledWith(
    "wedding-1/font-a1",
    expect.any(Uint8Array),
    expect.objectContaining({ upsert: true }),
  );
  expect(result).toEqual({ uploaded: 1, downloaded: 0 });
});

test("downloads a server asset this device does not hold yet", async () => {
  listMock.mockResolvedValue({ data: [{ name: "font-b2" }], error: null });
  collectAssetsMock.mockResolvedValue([]);
  heldAssetIdsMock.mockResolvedValue([]);
  downloadMock.mockResolvedValue({ data: new Blob([new Uint8Array([4, 5])]), error: null });

  const result = await syncAssets("wedding-1");

  expect(downloadMock).toHaveBeenCalledWith("wedding-1/font-b2");
  expect(acceptAssetMock).toHaveBeenCalledWith("font-b2", expect.any(Uint8Array));
  expect(result).toEqual({ uploaded: 0, downloaded: 1 });
});

test("does nothing when local and server already agree", async () => {
  listMock.mockResolvedValue({ data: [{ name: "font-a1" }], error: null });
  collectAssetsMock.mockResolvedValue([{ id: "font-a1", bytes: new Uint8Array([1]) }]);
  heldAssetIdsMock.mockResolvedValue(["font-a1"]);

  const result = await syncAssets("wedding-1");

  expect(uploadMock).not.toHaveBeenCalled();
  expect(downloadMock).not.toHaveBeenCalled();
  expect(result).toEqual({ uploaded: 0, downloaded: 0 });
});
