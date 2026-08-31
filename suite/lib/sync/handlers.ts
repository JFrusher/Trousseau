import type { Sealed } from "./crypto";
import type { SyncStore } from "./store";

/**
 * Ceilings, because this is a public URL.
 *
 * Nothing here needs to be generous: a slice is a wedding's worth of JSON and a
 * blob is a font or a photograph. Without a cap the endpoints are free storage
 * for anyone who finds the domain.
 */
export const MAX_SLICE_BYTES = 4 * 1024 * 1024;
export const MAX_BLOB_BYTES = 8 * 1024 * 1024;
export const MAX_SLICES_PER_PUSH = 16;
export const MAX_BLOBS_PER_WEDDING = 64;

const tooBig = (what: string, limit: number): Reply => ({
  status: 413,
  body: { error: `That ${what} is over the ${Math.round(limit / 1024 / 1024)}MB limit.` },
});

/**
 * What the route handlers do, without Next in the way.
 *
 * Pure functions over a `SyncStore`, so the authorisation and conflict rules
 * can be tested against the in-memory store — which is the only way they get
 * tested at all, and they are the two things here worth being sure of.
 */

export interface Reply {
  status: number;
  body: unknown;
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const bad = (message: string): Reply => ({ status: 400, body: { error: message } });
const denied = (): Reply =>
  // Deliberately the same message and status whether the wedding is missing or
  // the passphrase is wrong. Distinguishing them would turn this into an oracle
  // for which wedding ids exist.
  ({ status: 403, body: { error: "That wedding could not be opened with that passphrase." } });

/**
 * SHA-256 of the presented token, compared against what was stored.
 *
 * Returns null rather than throwing on anything that is not base64. The header
 * is attacker-controlled, and `atob` throwing turned a garbage token into a 500
 * — which is both wrong and a signal that the input was malformed rather than
 * merely incorrect.
 */
async function hashToken(writeToken: string): Promise<string | null> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(writeToken);
    // An explicit ArrayBuffer: `Uint8Array.from` yields one over
    // `ArrayBufferLike`, which `digest` will not take.
    bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return null;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Compare two hashes without leaking where they first differ.
 *
 * A plain `===` on strings short-circuits, and the timing of that is
 * measurable across a network given enough samples. The values here are
 * hashes of 256-bit secrets, so an attacker has nothing to walk — but constant
 * time costs one loop and removes the question.
 */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authorise(
  store: SyncStore,
  id: string,
  writeToken: string | null,
): Promise<{ ok: true } | { ok: false; reply: Reply }> {
  if (!writeToken) return { ok: false, reply: denied() };
  const wedding = await store.getWedding(id);
  if (!wedding) return { ok: false, reply: denied() };
  const presented = await hashToken(writeToken);
  if (presented === null || !sameSecret(presented, wedding.authHash)) {
    return { ok: false, reply: denied() };
  }
  return { ok: true };
}

export interface CreateInput {
  id: string;
  salt: string;
  authHash: string;
}

export async function createWedding(store: SyncStore, input: CreateInput): Promise<Reply> {
  if (!input.id || !input.salt || !input.authHash) return bad("Incomplete.");
  if (await store.getWedding(input.id)) return bad("That wedding already exists.");
  await store.createWedding({ ...input, createdAt: new Date().toISOString() });
  return ok({ id: input.id });
}

/**
 * The salt for a wedding, so a client can derive keys and try to open it.
 *
 * Public, and safe to be: a salt reveals nothing, and withholding it would only
 * mean the passphrase could not be used. A missing wedding returns a salt-shaped
 * nothing rather than a 404, so this cannot be used to enumerate ids.
 */
export async function getSalt(store: SyncStore, id: string): Promise<Reply> {
  const wedding = await store.getWedding(id);
  return ok({ salt: wedding?.salt ?? null });
}

export async function pull(
  store: SyncStore,
  id: string,
  writeToken: string | null,
): Promise<Reply> {
  const auth = await authorise(store, id, writeToken);
  if (!auth.ok) return auth.reply;
  return ok({ slices: await store.listSlices(id) });
}

export interface PushInput {
  slice: string;
  sealed: Sealed;
  expectedVersion: number;
}

/**
 * Write slices, each on its own version.
 *
 * Per slice rather than per document, so editing the seating while the other
 * laptop edits the timeline never conflicts — which is the ordinary case, and
 * the reason Trousseau's one-owner-per-slice rule is worth keeping here.
 * Rejected slices come back with what they lost to, so the client can show the
 * user both and let them choose.
 */
export async function push(
  store: SyncStore,
  id: string,
  writeToken: string | null,
  writes: PushInput[],
): Promise<Reply> {
  const auth = await authorise(store, id, writeToken);
  if (!auth.ok) return auth.reply;
  if (!Array.isArray(writes)) return bad("No slices given.");

  if (writes.length > MAX_SLICES_PER_PUSH) return bad("Too many slices in one push.");

  // The version each accepted write actually landed at, from the store rather
  // than guessed by the caller.
  const accepted: Array<{ slice: string; version: number }> = [];
  const rejected: Array<{ slice: string; theirs: unknown }> = [];

  for (const write of writes) {
    if (!write?.slice || !write.sealed?.ciphertext || !write.sealed.iv) {
      return bad(`Slice "${write?.slice ?? "?"}" was incomplete.`);
    }
    if (write.sealed.ciphertext.length > MAX_SLICE_BYTES) return tooBig("slice", MAX_SLICE_BYTES);
    const result = await store.putSlice(id, write.slice, write.sealed, write.expectedVersion);
    if (result.accepted) accepted.push({ slice: write.slice, version: result.record.version });
    else rejected.push({ slice: write.slice, theirs: result.record });
  }

  return ok({ accepted, rejected });
}

export async function listBlobs(
  store: SyncStore,
  id: string,
  writeToken: string | null,
): Promise<Reply> {
  const auth = await authorise(store, id, writeToken);
  if (!auth.ok) return auth.reply;
  return ok({ ids: await store.listBlobs(id) });
}

export async function putBlob(
  store: SyncStore,
  id: string,
  writeToken: string | null,
  blobId: string,
  sealed: Sealed,
): Promise<Reply> {
  const auth = await authorise(store, id, writeToken);
  if (!auth.ok) return auth.reply;
  if (!blobId || !sealed?.ciphertext || !sealed.iv) return bad("Incomplete asset.");
  if (sealed.ciphertext.length > MAX_BLOB_BYTES) return tooBig("file", MAX_BLOB_BYTES);

  const existing = await store.listBlobs(id);
  // A ceiling per wedding, so one document cannot become a file host.
  if (!existing.includes(blobId) && existing.length >= MAX_BLOBS_PER_WEDDING) {
    return bad(`This wedding already holds ${MAX_BLOBS_PER_WEDDING} uploaded files.`);
  }

  await store.putBlob(id, { blobId, ...sealed, createdAt: new Date().toISOString() });
  return ok({ blobId });
}

export async function getBlob(
  store: SyncStore,
  id: string,
  writeToken: string | null,
  blobId: string,
): Promise<Reply> {
  const auth = await authorise(store, id, writeToken);
  if (!auth.ok) return auth.reply;
  const record = await store.getBlob(id, blobId);
  if (!record) return { status: 404, body: { error: "No such file." } };
  return ok({ ciphertext: record.ciphertext, iv: record.iv });
}

export interface ShareInput {
  token: string;
  sealed: Sealed;
}

export async function putShare(
  store: SyncStore,
  id: string,
  writeToken: string | null,
  input: ShareInput,
): Promise<Reply> {
  const auth = await authorise(store, id, writeToken);
  if (!auth.ok) return auth.reply;
  if (!input?.token || !input.sealed?.ciphertext) return bad("Incomplete share.");
  if (input.sealed.ciphertext.length > MAX_SLICE_BYTES) return tooBig("share", MAX_SLICE_BYTES);

  const now = new Date().toISOString();
  await store.putShare({ token: input.token, ...input.sealed, createdAt: now, updatedAt: now });
  return ok({ token: input.token });
}

/**
 * A guest-facing share.
 *
 * No authorisation: the link's fragment holds the key, and the fragment never
 * reaches here. This endpoint hands out ciphertext to anyone who asks, which is
 * exactly what it is for — the bytes are meaningless without the fragment.
 */
export async function getShare(store: SyncStore, token: string): Promise<Reply> {
  const share = await store.getShare(token);
  if (!share) return { status: 404, body: { error: "That link is not live." } };
  return ok({ ciphertext: share.ciphertext, iv: share.iv, updatedAt: share.updatedAt });
}

export async function deleteShare(
  store: SyncStore,
  id: string,
  writeToken: string | null,
  token: string,
): Promise<Reply> {
  const auth = await authorise(store, id, writeToken);
  if (!auth.ok) return auth.reply;
  await store.deleteShare(token);
  return ok({ token });
}
