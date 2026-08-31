import { beforeEach, expect, test, vi } from "vitest";
import { emptyTrousseau } from "@jfrusher/trousseau";

const db = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (key: string) => db.get(key),
  set: async (key: string, value: unknown) => void db.set(key, value),
  del: async (key: string) => void db.delete(key),
  keys: async () => [...db.keys()],
}));

const { useTrousseauStore } = await import("./useTrousseauStore");

const store = () => useTrousseauStore.getState();
const names = () => Object.keys(store().doc.guests);

function guest(id: string) {
  return { [id]: { id, firstName: id, lastName: "" } };
}

beforeEach(async () => {
  db.clear();
  const doc = emptyTrousseau();
  useTrousseauStore.setState({
    status: "idle",
    error: null,
    savedAt: null,
    raw: doc as unknown as Record<string, unknown>,
    doc,
    past: [],
    future: [],
  });
  await store().hydrate();
});

test("undo goes back a step, redo comes forward again", () => {
  store().setSlice("guests", guest("a"), { label: "adding a guest" });
  store().setSlice("guests", { ...guest("a"), ...guest("b") }, { label: "adding a table" });

  expect(names()).toEqual(["a", "b"]);
  store().undo();
  expect(names()).toEqual(["a"]);
  store().undo();
  expect(names()).toEqual([]);
  store().redo();
  expect(names()).toEqual(["a"]);
  store().redo();
  expect(names()).toEqual(["a", "b"]);
});

test("a fresh edit after an undo abandons the redo branch", () => {
  store().setSlice("guests", guest("a"), { label: "adding a guest" });
  store().undo();
  store().setSlice("guests", guest("z"), { label: "adding a table" });

  expect(store().future).toHaveLength(0);
  store().redo();
  // Redo did nothing: replaying "a" here would resurrect a change that never
  // followed this state.
  expect(names()).toEqual(["z"]);
});

test("edits of the same kind moments apart are one undo step", () => {
  // Typing a table name is one keystroke per write. Seven undos to remove one
  // word is the behaviour this coalescing exists to prevent.
  for (const label of ["Ta", "Tab", "Tabl", "Table"]) {
    store().setSlice("seating", { tables: { t1: { id: "t1", label } } }, { label: "editing a table" });
  }

  expect(store().past).toHaveLength(1);
  store().undo();
  expect(store().doc.seating).toEqual({});
});

test("edits of different kinds stay separate steps", () => {
  store().setSlice("guests", guest("a"), { label: "adding a guest" });
  store().setSlice("guests", { ...guest("a"), ...guest("b") }, { label: "adding a table" });
  expect(store().past).toHaveLength(2);
});

test("a silent write is not undoable", () => {
  store().setSlice("guests", guest("a"), { label: "adding a guest" });
  const depth = store().past.length;

  // Reconciling a restored document is not something the user did.
  store().setSlice("guests", { ...guest("a"), ...guest("b") }, { silent: true });

  expect(store().past).toHaveLength(depth);
  store().undo();
  expect(names()).toEqual([]);
});

test("undo restores both halves of a seat together", () => {
  const seated = {
    guests: { g1: { id: "g1", firstName: "Charis", lastName: "", assignedTableId: "t1" } },
    seating: { tables: { t1: { id: "t1", label: "Table 1", assignedGuestIds: ["g1"] } } },
  };
  store().setSlices(
    [
      ["guests", seated.guests],
      ["seating", seated.seating],
    ],
    { label: "the seating" },
  );

  store().undo();
  // Both, or the guest would point at a table that has forgotten them.
  expect(store().doc.guests).toEqual({});
  expect(store().doc.seating).toEqual({});
});

test("history does not grow without limit", () => {
  for (let i = 0; i < 80; i++) {
    store().setSlice("guests", guest(`g${i}`), { label: `step ${i}` });
  }
  expect(store().past.length).toBeLessThanOrEqual(50);
});
