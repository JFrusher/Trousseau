import { afterEach, beforeEach, expect, test, vi } from "vitest";

/**
 * A browser that refuses IndexedDB — Firefox in private browsing, Safari with
 * site data blocked — throws when `idb-keyval` opens the database, which it
 * does *synchronously*. So this `set` is deliberately not `async`: an async one
 * would return a rejected promise, which the store already handled. The bug was
 * the other case, where the throw never reaches a promise at all and escapes a
 * `setTimeout` callback as an uncaught exception, taking the on-screen message
 * with it.
 */
const refused = new Error("IndexedDB is unavailable");
vi.mock("idb-keyval", () => ({
  get: async () => undefined,
  set: () => {
    throw refused;
  },
  del: async () => undefined,
  keys: async () => [],
}));

const { useTrousseauStore } = await import("./useTrousseauStore");
const { emptyTrousseau } = await import("@jfrusher/trousseau");

beforeEach(() => {
  vi.useFakeTimers();
  const doc = emptyTrousseau();
  useTrousseauStore.setState({
    status: "ready",
    error: null,
    savedAt: null,
    raw: doc as unknown as Record<string, unknown>,
    doc,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

test("a browser that refuses IndexedDB is reported, not thrown past", () => {
  useTrousseauStore.getState().setSlice("event", { coupleNames: "Charis & Jacob" });

  // Would be an uncaught exception rather than a returning call if the write
  // were not guarded.
  expect(() => vi.advanceTimersByTime(1000)).not.toThrow();

  const { error, savedAt } = useTrousseauStore.getState();
  expect(error).toContain(refused.message);
  // The point of the message: the user must not be told this was saved.
  expect(savedAt).toBeNull();
});
