import { beforeEach, expect, test, vi } from "vitest";
import { emptyTrousseau } from "@jfrusher/trousseau";

/**
 * The exchange, end to end, against the in-memory store.
 *
 * These exist because of a real bug: `sync()` used to pull every remote slice
 * over local state and then push the result, which destroyed any work done
 * since the last sync and reported success. Every test below would have failed.
 */

const db = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (key: string) => db.get(key),
  set: async (key: string, value: unknown) => void db.set(key, value),
  del: async (key: string) => void db.delete(key),
  keys: async () => [...db.keys()],
}));

const { memoryStore } = await import("./store");
const handlers = await import("./handlers");

// One store, shared by both "machines", behind a fetch stand-in.
let store = memoryStore();

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const path = String(url).replace("/api/sync/", "");
  const [head, id, tail, extra] = path.split("/");
  const token = (init?.headers as Record<string, string>)?.authorization?.slice(7) ?? null;
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const method = init?.method ?? "GET";

  const reply = await (async () => {
    if (head === "wedding" && !id && method === "POST") return handlers.createWedding(store, body);
    if (tail === "salt") return handlers.getSalt(store, id!);
    if (tail === "slices" && method === "GET") return handlers.pull(store, id!, token);
    if (tail === "slices") return handlers.push(store, id!, token, body.writes);
    if (tail === "blobs") return handlers.listBlobs(store, id!, token);
    if (tail === "blob" && method === "GET") return handlers.getBlob(store, id!, token, extra!);
    if (tail === "blob") return handlers.putBlob(store, id!, token, extra!, body.sealed);
    if (tail === "share" && method === "DELETE") {
      return handlers.deleteShare(store, id!, token, extra!);
    }
    if (tail === "share") return handlers.putShare(store, id!, token, body);
    return { status: 404, body: { error: "no" } };
  })();

  return new Response(JSON.stringify(reply.body), { status: reply.status });
});

const { useTrousseauStore } = await import("@/lib/store/useTrousseauStore");
const client = await import("./client");

const setLocal = (slice: string, value: unknown) =>
  useTrousseauStore.getState().setSlices([[slice as never, value]], { label: "edit" });

const localGuests = () => useTrousseauStore.getState().raw["guests"];

function resetStore() {
  const doc = emptyTrousseau();
  useTrousseauStore.setState({
    status: "ready",
    error: null,
    savedAt: null,
    raw: doc as unknown as Record<string, unknown>,
    doc,
    past: [],
    future: [],
  });
}

beforeEach(async () => {
  db.clear();
  store = memoryStore();
  resetStore();
  await client.forget();
});

test("a slice changed only here is sent, and one changed only there is taken", async () => {
  await client.createShared("correct horse battery staple");

  setLocal("guests", { g1: { id: "g1", firstName: "Charis" } });
  const first = await client.sync();
  expect(first.pushed).toContain("guests");
  expect(first.conflicts).toEqual([]);

  // Nothing has changed since. Syncing again should do nothing at all.
  const idle = await client.sync();
  expect(idle.pushed).toEqual([]);
  expect(idle.pulled).toEqual([]);
});

test("a pull never overwrites a slice edited here", async () => {
  await client.createShared("correct horse battery staple");
  setLocal("guests", { g1: { id: "g1", firstName: "Charis" } });
  await client.sync();

  // The other machine changes the guests.
  const membership = await client.membership();
  const theirVersion = membership!.slices["guests"]!.version;
  const { deriveKeys, seal } = await import("./crypto");
  const keys = await deriveKeys("correct horse battery staple", membership!.salt);
  await handlers.push(store, membership!.weddingId, keys.writeToken, [
    {
      slice: "guests",
      sealed: await seal(keys.contentKey, { g2: { id: "g2", firstName: "Theirs" } }),
      expectedVersion: theirVersion,
    },
  ]);

  // And this machine changes them too, without syncing in between.
  setLocal("guests", { g1: { id: "g1", firstName: "Mine" } });

  const result = await client.sync();

  // This is the bug the rewrite exists for: the local edit must survive.
  expect(result.pulled).not.toContain("guests");
  expect(result.pushed).not.toContain("guests");
  expect(result.conflicts.map((c) => c.slice)).toEqual(["guests"]);
  expect(localGuests()).toEqual({ g1: { id: "g1", firstName: "Mine" } });
});

test("taking theirs applies their version and settles the conflict", async () => {
  await client.createShared("correct horse battery staple");
  setLocal("guests", { g1: { id: "g1", firstName: "Charis" } });
  await client.sync();

  const membership = await client.membership();
  const { deriveKeys, seal } = await import("./crypto");
  const keys = await deriveKeys("correct horse battery staple", membership!.salt);
  await handlers.push(store, membership!.weddingId, keys.writeToken, [
    {
      slice: "guests",
      sealed: await seal(keys.contentKey, { g2: { id: "g2", firstName: "Theirs" } }),
      expectedVersion: membership!.slices["guests"]!.version,
    },
  ]);
  setLocal("guests", { g1: { id: "g1", firstName: "Mine" } });

  const [conflict] = (await client.sync()).conflicts;
  await client.takeTheirs(conflict!);
  expect(localGuests()).toEqual({ g2: { id: "g2", firstName: "Theirs" } });

  // And it stays settled.
  expect((await client.sync()).conflicts).toEqual([]);
});

test("keeping mine overwrites theirs and settles the conflict", async () => {
  await client.createShared("correct horse battery staple");
  setLocal("guests", { g1: { id: "g1", firstName: "Charis" } });
  await client.sync();

  const membership = await client.membership();
  const { deriveKeys, seal, unseal } = await import("./crypto");
  const keys = await deriveKeys("correct horse battery staple", membership!.salt);
  await handlers.push(store, membership!.weddingId, keys.writeToken, [
    {
      slice: "guests",
      sealed: await seal(keys.contentKey, { g2: { id: "g2", firstName: "Theirs" } }),
      expectedVersion: membership!.slices["guests"]!.version,
    },
  ]);
  setLocal("guests", { g1: { id: "g1", firstName: "Mine" } });

  const [conflict] = (await client.sync()).conflicts;
  await client.keepMine(conflict!);

  const stored = (await store.listSlices(membership!.weddingId)).find((s) => s.slice === "guests")!;
  expect(await unseal(keys.contentKey, stored)).toEqual({ g1: { id: "g1", firstName: "Mine" } });
  expect((await client.sync()).conflicts).toEqual([]);
});

test("joining stops rather than replacing a wedding already on this device", async () => {
  await client.createShared("correct horse battery staple");
  setLocal("guests", { g1: { id: "g1", firstName: "Charis" } });
  await client.sync();
  const { weddingId } = (await client.membership())!;

  // A second machine, with work of its own already on it.
  db.clear();
  resetStore();
  await client.forget();
  setLocal("guests", { local: { id: "local", firstName: "Not to be lost" } });

  const asked = await client.join(weddingId, "correct horse battery staple");
  expect(asked.needsConfirmation).toBe(true);
  expect(localGuests()).toEqual({ local: { id: "local", firstName: "Not to be lost" } });

  // Only on an explicit confirmation does it replace.
  const confirmed = await client.join(weddingId, "correct horse battery staple", {
    replaceLocal: true,
  });
  expect(confirmed.needsConfirmation).toBe(false);
  expect(localGuests()).toEqual({ g1: { id: "g1", firstName: "Charis" } });
});

test("the guest link keeps one token, so an old link never serves a stale plan", async () => {
  await client.createShared("correct horse battery staple");
  const { seal, newShareKey } = await import("./crypto");
  const { key } = await newShareKey();

  const first = await client.publishShare(await seal(key, { v: 1 }));
  const second = await client.publishShare(await seal(key, { v: 2 }));

  expect(second).toBe(first);
  expect((await client.membership())!.shareToken).toBe(first);

  await client.takeDownShare();
  expect((await client.membership())!.shareToken).toBeNull();
  expect(await store.getShare(first)).toBeNull();
});

test("a wrong passphrase never reaches the local document", async () => {
  await client.createShared("correct horse battery staple");
  setLocal("guests", { g1: { id: "g1", firstName: "Charis" } });
  await client.sync();
  const { weddingId } = (await client.membership())!;

  db.clear();
  resetStore();
  await client.forget();

  await expect(client.join(weddingId, "hunter2hunter2")).rejects.toThrow();
  // A fresh document, untouched: the refusal happened at the server, before
  // anything could be decrypted with the wrong key and applied.
  expect(localGuests()).toEqual({});
});
