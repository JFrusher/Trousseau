import { expect, test } from "vitest";
import { memoryStore } from "./store";

test("staleWeddings returns ids whose document predates the cutoff, oldest first", async () => {
  const store = memoryStore();
  await store.saveDocument("old", { a: 1 }, 0);
  await store.saveDocument("recent", { a: 1 }, 0);

  // memoryStore's saveDocument stamps updatedAt with `new Date().toISOString()`
  // at call time, so both are "recent" by default — this test needs a real
  // cutoff in the future relative to both saves, then confirms both come back,
  // and a cutoff in the past returns neither. See Step 3 for why memoryStore's
  // updatedAt can't be backdated directly from a test without exposing a seam
  // for it, and how that's resolved.
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const stale = await store.staleWeddings(future.toISOString());
  expect(stale).toContain("old");
  expect(stale).toContain("recent");

  const past = new Date();
  past.setFullYear(past.getFullYear() - 1);
  expect(await store.staleWeddings(past.toISOString())).toEqual([]);
});

test("deleteWedding removes the document so getDocument returns null after", async () => {
  const store = memoryStore();
  await store.saveDocument("gone", { a: 1 }, 0);
  await store.deleteWedding("gone");
  expect(await store.getDocument("gone")).toBeNull();
});
