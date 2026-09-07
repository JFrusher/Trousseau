import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  get: async () => undefined,
  set: async () => undefined,
  del: async () => undefined,
}));

const { useTrousseauStore } = await import("@/lib/store/useTrousseauStore");
const { isWeddingEmpty, loadExampleWedding } = await import("./exampleWedding");
const { emptyTrousseau } = await import("@jfrusher/trousseau");

const example = { event: { coupleNames: "Alex & Sam" }, guests: { g1: { id: "g1" } } };

beforeEach(() => {
  const doc = emptyTrousseau();
  useTrousseauStore.setState({
    status: "ready",
    error: null,
    raw: doc as unknown as Record<string, unknown>,
    doc,
    past: [],
    future: [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => example })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("an untouched wedding is empty, and loads without asking anything", async () => {
  const confirmed = vi.fn(() => false);
  vi.stubGlobal("confirm", confirmed);

  expect(isWeddingEmpty()).toBe(true);
  await expect(loadExampleWedding()).resolves.toBe("loaded");
  // Nothing to lose, so nothing to ask about.
  expect(confirmed).not.toHaveBeenCalled();
});

test("a wedding with guests in it is never replaced without a yes", async () => {
  const doc = { ...emptyTrousseau(), guests: { a: { id: "a" } } };
  useTrousseauStore.setState({ raw: doc as unknown as Record<string, unknown>, doc });
  vi.stubGlobal("confirm", vi.fn(() => false));

  expect(isWeddingEmpty()).toBe(false);
  await expect(loadExampleWedding()).resolves.toBe("cancelled");
  // The refusal has to leave the document exactly as it was.
  expect(Object.keys(useTrousseauStore.getState().doc.guests)).toEqual(["a"]);
});

test("saying yes replaces it, without becoming an undo step", async () => {
  const doc = { ...emptyTrousseau(), guests: { a: { id: "a" } } };
  useTrousseauStore.setState({ raw: doc as unknown as Record<string, unknown>, doc, past: [] });
  vi.stubGlobal("confirm", vi.fn(() => true));

  await expect(loadExampleWedding()).resolves.toBe("loaded");
  expect(useTrousseauStore.getState().doc.event.coupleNames).toBe("Alex & Sam");
  // Silent: offering to undo would offer to restore what the user was just
  // warned they were replacing.
  expect(useTrousseauStore.getState().past).toEqual([]);
});
