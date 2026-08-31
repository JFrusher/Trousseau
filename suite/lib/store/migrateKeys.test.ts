import { beforeEach, expect, test, vi } from "vitest";

const db = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (key: string) => db.get(key),
  set: async (key: string, value: unknown) => void db.set(key, value),
  del: async (key: string) => void db.delete(key),
  keys: async () => [...db.keys()],
}));

const { migrateLegacyKeys } = await import("./migrateKeys");

beforeEach(() => db.clear());

test("a wedding stored under the old name is moved, not lost", async () => {
  db.set("tableaux.suite.document", { guests: { g1: {} } });
  db.set("tableaux.suite.sync", { weddingId: "abc" });

  await migrateLegacyKeys();

  expect(db.get("trousseau.document")).toEqual({ guests: { g1: {} } });
  expect(db.get("trousseau.sync")).toEqual({ weddingId: "abc" });
  expect(db.has("tableaux.suite.document")).toBe(false);
});

test("uploaded fonts and artwork come across too", async () => {
  db.set("tableaux.suite.blob.abc123", new Uint8Array([1, 2, 3]));
  db.set("tableaux.suite.blob.def456", new Uint8Array([4]));

  await migrateLegacyKeys();

  expect(db.get("trousseau.blob.abc123")).toEqual(new Uint8Array([1, 2, 3]));
  expect(db.get("trousseau.blob.def456")).toEqual(new Uint8Array([4]));
  expect([...db.keys()].some((k) => k.startsWith("tableaux."))).toBe(false);
});

test("a device that has already migrated is left alone", async () => {
  db.set("trousseau.document", { current: true });
  db.set("tableaux.suite.document", { stale: true });

  await migrateLegacyKeys();

  // The new key is the truth; the stale copy must not overwrite it.
  expect(db.get("trousseau.document")).toEqual({ current: true });
});

test("nothing to move is not an error", async () => {
  await expect(migrateLegacyKeys()).resolves.toEqual({ moved: [] });
});

test("keys belonging to anything else are untouched", async () => {
  db.set("something.else", { keep: true });
  await migrateLegacyKeys();
  expect(db.get("something.else")).toEqual({ keep: true });
});

test("a migration that fails does not stop the document loading", async () => {
  // Housekeeping must never brick the app. A store whose `keys()` throws — an
  // old browser, a locked database — should still open the wedding under the
  // current key.
  vi.resetModules();
  vi.doMock("idb-keyval", () => ({
    get: async (key: string) => (key === "trousseau.document" ? { guests: {} } : undefined),
    set: async () => undefined,
    del: async () => undefined,
    keys: async () => {
      throw new Error("this browser will not enumerate keys");
    },
  }));

  const { useTrousseauStore } = await import("./useTrousseauStore");
  await useTrousseauStore.getState().hydrate();

  expect(useTrousseauStore.getState().status).toBe("ready");
  expect(useTrousseauStore.getState().error).toBeNull();
  vi.doUnmock("idb-keyval");
});
