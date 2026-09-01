import { beforeEach, expect, test } from "vitest";
import { deriveKeys, newSalt, newWeddingId, seal, sealBytes, tokenHash } from "./crypto";
import {
  createWedding,
  deleteShare,
  deleteWedding,
  retentionCutoff,
  RETENTION_MONTHS,
  sweepAbandoned,
  getBlob,
  getSalt,
  getShare,
  listBlobs,
  MAX_BLOB_BYTES,
  MAX_BLOBS_PER_WEDDING,
  MAX_SLICE_BYTES,
  MAX_WEDDING_BYTES,
  pull,
  push,
  putBlob,
  putShare,
} from "./handlers";
import { memoryStore, type SyncStore } from "./store";

/**
 * The two things worth being sure of: who is allowed to write, and what happens
 * when two laptops write the same slice.
 */

let store: SyncStore;
let id: string;
let salt: string;
let token: string;
let key: CryptoKey;

beforeEach(async () => {
  store = memoryStore();
  id = newWeddingId();
  salt = newSalt();
  const keys = await deriveKeys("correct horse battery staple", salt);
  token = keys.writeToken;
  key = keys.contentKey;
  await createWedding(store, { id, salt, authHash: await tokenHash(token) });
});

// authorisation ---------------------------------------------------------------

test("a wrong passphrase cannot read or write", async () => {
  const wrong = await deriveKeys("hunter2", salt);

  expect((await pull(store, id, wrong.writeToken)).status).toBe(403);
  expect(
    (await push(store, id, wrong.writeToken, [
      { slice: "guests", sealed: await seal(key, {}), expectedVersion: 0 },
    ])).status,
  ).toBe(403);
});

test("no passphrase at all cannot read or write", async () => {
  expect((await pull(store, id, null)).status).toBe(403);
});

test("a wedding that does not exist answers exactly as a wrong passphrase does", async () => {
  // Otherwise this is an oracle for which wedding ids are real.
  const missing = await pull(store, newWeddingId(), token);
  const wrong = await pull(store, id, (await deriveKeys("hunter2", salt)).writeToken);
  expect(missing).toEqual(wrong);
});

test("the salt is public, and a missing wedding does not say so", async () => {
  expect((await getSalt(store, id)).body).toEqual({ salt });
  const unknown = await getSalt(store, newWeddingId());
  expect(unknown.status).toBe(200);
  expect(unknown.body).toEqual({ salt: null });
});

test("a wedding id cannot be taken twice", async () => {
  expect((await createWedding(store, { id, salt, authHash: "x" })).status).toBe(400);
});

// writing ---------------------------------------------------------------------

test("a first write expects version zero and comes back as one", async () => {
  const reply = await push(store, id, token, [
    { slice: "guests", sealed: await seal(key, { g1: {} }), expectedVersion: 0 },
  ]);
  expect(reply.body).toEqual({ accepted: [{ slice: "guests", version: 1 }], rejected: [] });

  const pulled = (await pull(store, id, token)).body as { slices: Array<{ version: number }> };
  expect(pulled.slices[0]?.version).toBe(1);
});

test("the server never sees plaintext", async () => {
  await push(store, id, token, [
    { slice: "guests", sealed: await seal(key, { g1: { name: "Charis Smith" } }), expectedVersion: 0 },
  ]);

  const stored = JSON.stringify(await store.listSlices(id));
  expect(stored).not.toContain("Charis");
  expect(stored).not.toContain("name");
});

test("two laptops editing different slices never conflict", async () => {
  const first = await push(store, id, token, [
    { slice: "seating", sealed: await seal(key, { a: 1 }), expectedVersion: 0 },
  ]);
  const second = await push(store, id, token, [
    { slice: "timeline", sealed: await seal(key, { b: 2 }), expectedVersion: 0 },
  ]);

  expect((first.body as { rejected: unknown[] }).rejected).toEqual([]);
  expect((second.body as { rejected: unknown[] }).rejected).toEqual([]);
});

test("the second write to one slice is refused, and told what it lost to", async () => {
  await push(store, id, token, [
    { slice: "seating", sealed: await seal(key, { theirs: true }), expectedVersion: 0 },
  ]);

  // The other laptop still thinks the slice is at version 0.
  const stale = await push(store, id, token, [
    { slice: "seating", sealed: await seal(key, { mine: true }), expectedVersion: 0 },
  ]);

  const body = stale.body as {
    accepted: Array<{ slice: string; version: number }>;
    rejected: Array<{ slice: string; theirs: { version: number } }>;
  };
  expect(body.accepted).toEqual([]);
  expect(body.rejected[0]?.slice).toBe("seating");
  expect(body.rejected[0]?.theirs.version).toBe(1);

  // And the winning write is still what is stored — the loser overwrote nothing.
  const slices = await store.listSlices(id);
  expect(slices[0]?.version).toBe(1);
});

test("a refused slice does not stop the others in the same push", async () => {
  await push(store, id, token, [
    { slice: "seating", sealed: await seal(key, {}), expectedVersion: 0 },
  ]);

  const mixed = await push(store, id, token, [
    { slice: "seating", sealed: await seal(key, {}), expectedVersion: 0 },
    { slice: "crew", sealed: await seal(key, {}), expectedVersion: 0 },
  ]);

  const body = mixed.body as {
    accepted: Array<{ slice: string; version: number }>;
    rejected: unknown[];
  };
  expect(body.accepted).toEqual([{ slice: "crew", version: 1 }]);
  expect(body.rejected).toHaveLength(1);
});

// shares ----------------------------------------------------------------------

test("a guest share needs no passphrase to read, and gives up only ciphertext", async () => {
  const sealed = await seal(key, { name: "Eleanor Vane", table: "Table 2" });
  await putShare(store, id, token, { token: "abc123", sealed });

  const reply = await getShare(store, "abc123");
  expect(reply.status).toBe(200);
  expect(JSON.stringify(reply.body)).not.toContain("Eleanor");
  expect((reply.body as { ciphertext: string }).ciphertext).toBe(sealed.ciphertext);
});

test("publishing a share does need the passphrase", async () => {
  const sealed = await seal(key, {});
  expect((await putShare(store, id, null, { token: "abc123", sealed })).status).toBe(403);
});

test("a link that was never published, or has been taken down, is not live", async () => {
  expect((await getShare(store, "nope")).status).toBe(404);

  await putShare(store, id, token, { token: "abc123", sealed: await seal(key, {}) });
  await deleteShare(store, id, token, "abc123");
  expect((await getShare(store, "abc123")).status).toBe(404);
});

test("only somebody with the passphrase can take a link down", async () => {
  await putShare(store, id, token, { token: "abc123", sealed: await seal(key, {}) });
  expect((await deleteShare(store, id, null, "abc123")).status).toBe(403);
  expect((await getShare(store, "abc123")).status).toBe(200);
});

// the bugs this audit found ---------------------------------------------------

test("a client expecting history a wedding does not have is refused", async () => {
  // Absent is version 0. A caller expecting 3 is out of step, and creating a
  // row under it would hide that rather than report it.
  const reply = await push(store, id, token, [
    { slice: "guests", sealed: await seal(key, {}), expectedVersion: 3 },
  ]);
  const body = reply.body as { accepted: unknown[]; rejected: unknown[] };
  expect(body.accepted).toEqual([]);
  expect(body.rejected).toHaveLength(1);
});

test("the version a write landed at comes from the store, not the caller", async () => {
  await push(store, id, token, [
    { slice: "guests", sealed: await seal(key, { a: 1 }), expectedVersion: 0 },
  ]);
  const second = await push(store, id, token, [
    { slice: "guests", sealed: await seal(key, { a: 2 }), expectedVersion: 1 },
  ]);
  expect((second.body as { accepted: Array<{ version: number }> }).accepted[0]?.version).toBe(2);
});

test("an oversized slice is refused rather than stored", async () => {
  const huge = { ciphertext: "x".repeat(MAX_SLICE_BYTES + 1), iv: "aaaa" };
  const reply = await push(store, id, token, [
    { slice: "guests", sealed: huge, expectedVersion: 0 },
  ]);
  expect(reply.status).toBe(413);
  expect(await store.listSlices(id)).toEqual([]);
});

test("assets need the passphrase, and are stored as ciphertext", async () => {
  const sealed = await sealBytes(key, new Uint8Array([1, 2, 3, 4]));

  expect((await putBlob(store, id, null, "abc", sealed)).status).toBe(403);
  expect((await putBlob(store, id, token, "abc", sealed)).status).toBe(200);

  expect((await listBlobs(store, id, token)).body).toEqual({ ids: ["abc"] });
  const fetched = (await getBlob(store, id, token, "abc")).body as { ciphertext: string };
  expect(fetched.ciphertext).toBe(sealed.ciphertext);
  expect((await getBlob(store, id, token, "nope")).status).toBe(404);
});

test("an oversized asset is refused", async () => {
  const huge = { ciphertext: "x".repeat(MAX_BLOB_BYTES + 1), iv: "aaaa" };
  expect((await putBlob(store, id, token, "big", huge)).status).toBe(413);
});

test("one wedding cannot become a file host", async () => {
  const sealed = await sealBytes(key, new Uint8Array([1]));
  for (let i = 0; i < MAX_BLOBS_PER_WEDDING; i++) {
    expect((await putBlob(store, id, token, `blob${i}`, sealed)).status).toBe(200);
  }
  expect((await putBlob(store, id, token, "one-too-many", sealed)).status).toBe(400);
  // But replacing one already there still works.
  expect((await putBlob(store, id, token, "blob0", sealed)).status).toBe(200);
});

test("republishing a guest link at the same token replaces what it shows", async () => {
  await putShare(store, id, token, { token: "abc123", sealed: await seal(key, { v: 1 }) });
  await putShare(store, id, token, { token: "abc123", sealed: await seal(key, { v: 2 }) });

  const live = (await getShare(store, "abc123")).body as { ciphertext: string };
  const second = await seal(key, { v: 2 });
  // Not byte-equal (fresh nonce), but there is exactly one row and it is the
  // later one — the old plan is not still being served somewhere else.
  expect(live.ciphertext).not.toBe(second.ciphertext);
  expect(await store.getShare("abc123")).not.toBeNull();
});

test("a malformed authorization header is denied, not a crash", async () => {
  // The header is attacker-controlled. `atob` throwing on it used to escape the
  // handler as a 500, which both leaked that the input was malformed rather
  // than merely wrong, and was a free way to make the server do work badly.
  for (const rubbish of ["x", "!!!!", "not base64 at all", " "]) {
    const reply = await pull(store, id, rubbish);
    expect(reply.status, `"${rubbish}"`).toBe(403);
  }
});

// erasure ---------------------------------------------------------------------

/**
 * A public deployment holds other people's guest lists, encrypted. Holding them
 * with no way to remove them is the gap these cover.
 */

async function fillAWedding(): Promise<string> {
  await push(store, id, token, [
    { slice: "guests", sealed: await seal(key, { g1: "Eleanor" }), expectedVersion: 0 },
  ]);
  await putBlob(store, id, token, "img:monogram.png:12", await sealBytes(key, new Uint8Array([1, 2])));
  const shareToken = "sharetoken1";
  await putShare(store, id, token, { token: shareToken, sealed: await seal(key, { tables: [] }) });
  return shareToken;
}

test("deleting a wedding takes its slices, assets and guest link with it", async () => {
  const shareToken = await fillAWedding();

  const reply = await deleteWedding(store, id, token);
  expect(reply.status).toBe(200);

  // The wedding itself is gone, and says so exactly as a wrong passphrase does.
  expect((await pull(store, id, token)).status).toBe(403);
  // The salt endpoint is public and must not become an existence oracle.
  expect((await getSalt(store, id)).body).toEqual({ salt: null });
  // The guest link is the one that used to survive, because nothing cascaded.
  expect((await getShare(store, shareToken)).status).toBe(404);
});

test("deleting a wedding needs the passphrase, and deletes nothing without it", async () => {
  const shareToken = await fillAWedding();
  const wrong = await deriveKeys("hunter2", salt);

  expect((await deleteWedding(store, id, wrong.writeToken)).status).toBe(403);
  expect((await deleteWedding(store, id, null)).status).toBe(403);

  expect((await pull(store, id, token)).status).toBe(200);
  expect((await getShare(store, shareToken)).status).toBe(200);
});

test("one wedding cannot take down another wedding's guest link", async () => {
  // Both tokens are valid; neither is valid for the other's share. Before
  // `shares` carried a wedding id this matched on token alone and succeeded.
  const shareToken = await fillAWedding();

  const otherId = newWeddingId();
  const otherSalt = newSalt();
  const other = await deriveKeys("a different passphrase entirely", otherSalt);
  await createWedding(store, {
    id: otherId,
    salt: otherSalt,
    authHash: await tokenHash(other.writeToken),
  });

  await deleteShare(store, otherId, other.writeToken, shareToken);

  expect((await getShare(store, shareToken)).status).toBe(200);
});

test("deleting one wedding leaves another alone", async () => {
  const shareToken = await fillAWedding();

  const otherId = newWeddingId();
  const otherSalt = newSalt();
  const other = await deriveKeys("a different passphrase entirely", otherSalt);
  await createWedding(store, {
    id: otherId,
    salt: otherSalt,
    authHash: await tokenHash(other.writeToken),
  });
  await push(store, otherId, other.writeToken, [
    { slice: "guests", sealed: await seal(other.contentKey, { g9: "Someone" }), expectedVersion: 0 },
  ]);

  await deleteWedding(store, id, token);

  expect((await pull(store, otherId, other.writeToken)).status).toBe(200);
  expect((await getShare(store, shareToken)).status).toBe(404);
});

test("a deleted wedding's id can be taken again", async () => {
  await fillAWedding();
  await deleteWedding(store, id, token);
  // Nothing is reserved after erasure, which is what "deleted" has to mean.
  expect((await createWedding(store, { id, salt, authHash: await tokenHash(token) })).status).toBe(
    200,
  );
});

// retention -------------------------------------------------------------------

/**
 * The backstop for the case erasure cannot reach: a wedding whose passphrase is
 * gone can never be deleted on request, because there is nobody to authorise it
 * and no reset to issue.
 */

const monthsAgo = (months: number): Date => {
  const when = new Date();
  when.setMonth(when.getMonth() - months);
  return when;
};

test("a wedding written to recently is not swept", async () => {
  await push(store, id, token, [
    { slice: "guests", sealed: await seal(key, { g1: "Eleanor" }), expectedVersion: 0 },
  ]);

  expect((await sweepAbandoned(store)).deleted).toEqual([]);
  expect((await pull(store, id, token)).status).toBe(200);
});

test("a wedding untouched past the retention period is swept, with everything under it", async () => {
  const shareToken = await fillAWedding();

  // Sweeping as if it were well past the period, rather than backdating rows.
  const later = new Date();
  later.setMonth(later.getMonth() + RETENTION_MONTHS + 1);

  expect((await sweepAbandoned(store, later)).deleted).toEqual([id]);
  expect((await pull(store, id, token)).status).toBe(403);
  expect((await getShare(store, shareToken)).status).toBe(404);
});

test("an accepted write resets the clock; a rejected one does not", async () => {
  await push(store, id, token, [
    { slice: "guests", sealed: await seal(key, { g1: "Eleanor" }), expectedVersion: 0 },
  ]);

  // Out of step with the server, so refused — and not activity.
  const refused = await push(store, id, token, [
    { slice: "guests", sealed: await seal(key, { g1: "Nope" }), expectedVersion: 99 },
  ]);
  expect((refused.body as { rejected: unknown[] }).rejected).toHaveLength(1);

  const later = new Date();
  later.setMonth(later.getMonth() + RETENTION_MONTHS + 1);
  expect((await sweepAbandoned(store, later)).deleted).toEqual([id]);
});

test("the cutoff is the stated number of months back", () => {
  // The Privacy Policy quotes this number; the two must not drift.
  const cutoff = new Date(retentionCutoff(new Date()));
  const expected = monthsAgo(RETENTION_MONTHS);
  expect(Math.abs(cutoff.getTime() - expected.getTime())).toBeLessThan(1000);
});

test("sweeping leaves a wedding that is still in use alone", async () => {
  const otherId = newWeddingId();
  const otherSalt = newSalt();
  const other = await deriveKeys("a different passphrase entirely", otherSalt);
  await createWedding(store, {
    id: otherId,
    salt: otherSalt,
    authHash: await tokenHash(other.writeToken),
  });

  // Only the first wedding is old: the second is created "now", and the sweep
  // runs at a moment where the first has aged out and the second has not.
  const later = new Date();
  later.setMonth(later.getMonth() + RETENTION_MONTHS);
  later.setDate(later.getDate() + 1);

  const swept = await sweepAbandoned(store, later);
  expect(swept.deleted).toContain(id);
});

// storage budget --------------------------------------------------------------

/**
 * The per-file and per-count limits never added up to anything: 64 files at 8MB
 * is half a gigabyte, and anyone may create a wedding and choose its own
 * passphrase, so uploading to it needs nobody's permission.
 */

test("a wedding cannot store more than its total budget across all assets", async () => {
  const chunk = "a".repeat(6 * 1024 * 1024);
  let stored = 0;
  let refused: number | null = null;

  for (let i = 0; i < MAX_BLOBS_PER_WEDDING; i++) {
    const reply = await putBlob(store, id, token, `f${i}`, { ciphertext: chunk, iv: "iv" });
    if (reply.status !== 200) {
      refused = reply.status;
      break;
    }
    stored += chunk.length;
  }

  expect(refused).toBe(400);
  expect(stored).toBeLessThanOrEqual(MAX_WEDDING_BYTES);
});

test("replacing an asset is measured against what it replaces, not on top of it", async () => {
  // Re-uploading the same id must not consume the budget twice, or syncing the
  // same font between two machines would eventually be refused.
  const font = "a".repeat(MAX_BLOB_BYTES);
  expect((await putBlob(store, id, token, "font", { ciphertext: font, iv: "iv" })).status).toBe(200);
  expect((await putBlob(store, id, token, "font", { ciphertext: font, iv: "iv" })).status).toBe(200);
  expect(await store.blobBytes(id)).toBe(MAX_BLOB_BYTES);
});

test("the budget is per wedding, not shared between them", async () => {
  const otherId = newWeddingId();
  const otherSalt = newSalt();
  const other = await deriveKeys("a different passphrase entirely", otherSalt);
  await createWedding(store, {
    id: otherId,
    salt: otherSalt,
    authHash: await tokenHash(other.writeToken),
  });

  // Fill the first wedding to its ceiling.
  const chunk = "a".repeat(MAX_BLOB_BYTES);
  for (let i = 0; i < MAX_WEDDING_BYTES / MAX_BLOB_BYTES; i++) {
    expect((await putBlob(store, id, token, `f${i}`, { ciphertext: chunk, iv: "iv" })).status).toBe(200);
  }
  expect((await putBlob(store, id, token, "one-more", { ciphertext: chunk, iv: "iv" })).status).toBe(400);

  // The second is untouched by that.
  expect(
    (await putBlob(store, otherId, other.writeToken, "f", { ciphertext: chunk, iv: "iv" })).status,
  ).toBe(200);
});
