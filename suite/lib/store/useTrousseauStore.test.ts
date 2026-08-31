import { beforeEach, expect, test, vi } from "vitest";

const db = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (key: string) => db.get(key),
  set: async (key: string, value: unknown) => void db.set(key, value),
  del: async (key: string) => void db.delete(key),
  keys: async () => [...db.keys()],
}));

const { STORAGE_KEY, flushPersist, selectGuestCount, useTrousseauStore } = await import(
  "./useTrousseauStore"
);
const { emptyTrousseau } = await import("@jfrusher/trousseau");

beforeEach(() => {
  db.clear();
  const doc = emptyTrousseau();
  useTrousseauStore.setState({
    status: "idle",
    error: null,
    savedAt: null,
    raw: doc as unknown as Record<string, unknown>,
    doc,
  });
});

test("an empty store hydrates to a fresh wedding", async () => {
  await useTrousseauStore.getState().hydrate();
  expect(useTrousseauStore.getState().status).toBe("ready");
  expect(selectGuestCount(useTrousseauStore.getState())).toBe(0);
});

test("a write to one slice leaves every other key byte-for-byte", async () => {
  // A slice belonging to a tool that does not exist yet. Losing it is the one
  // failure the whole envelope design exists to prevent.
  db.set(STORAGE_KEY, {
    ...emptyTrousseau(),
    guests: { g1: { id: "g1", name: "Charis" } },
    photobooth: { props: ["hat"] },
  });
  await useTrousseauStore.getState().hydrate();

  useTrousseauStore.getState().setSlice("guests", {
    g1: { id: "g1", name: "Charis" },
    g2: { id: "g2", name: "Alexander" },
  });
  await flushPersist();

  expect(selectGuestCount(useTrousseauStore.getState())).toBe(2);
  const stored = db.get(STORAGE_KEY) as Record<string, unknown>;
  expect(stored["photobooth"]).toEqual({ props: ["hat"] });
});

test("an unreadable document is refused, never overwritten", async () => {
  db.set(STORAGE_KEY, { kind: "trousseau", version: 1, event: { date: 42 } });
  await useTrousseauStore.getState().hydrate();

  expect(useTrousseauStore.getState().status).toBe("error");

  // A write while unreadable must not reach storage.
  useTrousseauStore.getState().setSlice("guests", { g1: { id: "g1" } });
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(db.get(STORAGE_KEY)).toEqual({
    kind: "trousseau",
    version: 1,
    event: { date: 42 },
  });
});
