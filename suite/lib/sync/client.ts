"use client";

import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import { SLICE_NAMES } from "@jfrusher/trousseau";
import { useTrousseauStore, type SuiteSlice } from "@/lib/store/useTrousseauStore";
import { readStationery } from "@/lib/placecards/stationery";
import { getBlob, putBlob } from "@/lib/placecards/blobStore";
import {
  deriveKeys,
  fingerprint,
  newSalt,
  newWeddingId,
  seal,
  sealBytes,
  tokenHash,
  unseal,
  unsealBytes,
  type Sealed,
} from "./crypto";

/**
 * Syncing one wedding between two machines.
 *
 * Everything is encrypted here, before it goes anywhere. The passphrase is
 * never stored and never transmitted — only the key it derives stays in memory
 * for the session, and only the token it derives reaches the server.
 *
 * The rule that makes this safe: **a slice you have edited is never overwritten
 * by a pull.** Each slice is remembered by its version on the server *and* its
 * content fingerprint at the moment it was last agreed. From those two facts
 * the client can tell, per slice, whether it changed here, changed there, or
 * both — and only the last of those is a conflict a person has to settle.
 *
 * An earlier version pulled everything unconditionally and then pushed, which
 * had the effect of destroying local work and reporting success. Hence the
 * fingerprints.
 */

/** The slices that sync. `timeline` is this app's own addition to the envelope. */
const SYNCED: SuiteSlice[] = [...SLICE_NAMES, "timeline"];

/** What is agreed about one slice as of the last successful exchange. */
interface Agreed {
  version: number;
  fingerprint: string;
}

/** Remembered between sessions. Never the passphrase, never the key. */
interface Membership {
  weddingId: string;
  salt: string;
  /** The one live guest link, so republishing replaces it rather than adding. */
  shareToken: string | null;
  slices: Record<string, Agreed>;
  /** Blob ids known to be on the server, so they are not re-uploaded. */
  blobs: string[];
}

const MEMBERSHIP_KEY = "trousseau.sync";

export interface Session {
  weddingId: string;
  contentKey: CryptoKey;
  writeToken: string;
}

/** Held in memory only. A reload asks for the passphrase again, by design. */
let session: Session | null = null;

export const currentSession = (): Session | null => session;

export async function membership(): Promise<Membership | null> {
  const stored: unknown = await idbGet(MEMBERSHIP_KEY);
  if (typeof stored !== "object" || stored === null) return null;
  const m = stored as Partial<Membership>;
  if (typeof m.weddingId !== "string" || typeof m.salt !== "string") return null;
  return {
    weddingId: m.weddingId,
    salt: m.salt,
    shareToken: typeof m.shareToken === "string" ? m.shareToken : null,
    slices: typeof m.slices === "object" && m.slices !== null ? m.slices : {},
    blobs: Array.isArray(m.blobs) ? m.blobs : [],
  };
}

async function save(next: Membership): Promise<void> {
  await idbSet(MEMBERSHIP_KEY, next);
}

export async function forget(): Promise<void> {
  session = null;
  await idbDel(MEMBERSHIP_KEY);
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`/api/sync/${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session.writeToken}` } : {}),
      ...init.headers,
    },
  });
}

async function body<T>(response: Response): Promise<T> {
  const parsed = (await response.json().catch(() => null)) as T & { error?: string };
  if (!response.ok) throw new Error(parsed?.error ?? `The server answered ${response.status}.`);
  return parsed;
}

const localValue = (slice: string): unknown => useTrousseauStore.getState().raw[slice];

// starting and joining --------------------------------------------------------

export async function createShared(passphrase: string): Promise<Session> {
  const weddingId = newWeddingId();
  const salt = newSalt();
  const keys = await deriveKeys(passphrase, salt);

  await body(
    await api("wedding", {
      method: "POST",
      body: JSON.stringify({ id: weddingId, salt, authHash: await tokenHash(keys.writeToken) }),
    }),
  );

  session = { weddingId, contentKey: keys.contentKey, writeToken: keys.writeToken };
  await save({ weddingId, salt, shareToken: null, slices: {}, blobs: [] });
  await sync();
  return session;
}

/**
 * Open a wedding somebody else started, or this one again after a reload.
 *
 * Everything on the server is taken as agreed, because this machine has nothing
 * to compare against yet — but only after the local document is empty or the
 * user has been asked. A join that silently replaced a half-planned wedding on
 * this device would be the same data loss by another route.
 */
export async function join(
  weddingId: string,
  passphrase: string,
  options: { replaceLocal?: boolean } = {},
): Promise<{ session: Session; needsConfirmation: boolean }> {
  const { salt } = await body<{ salt: string | null }>(await api(`wedding/${weddingId}/salt`));
  if (!salt) throw new Error("That wedding could not be opened with that passphrase.");

  const keys = await deriveKeys(passphrase, salt);
  session = { weddingId, contentKey: keys.contentKey, writeToken: keys.writeToken };

  let remote: RemoteSlice[];
  try {
    remote = await fetchSlices(weddingId);
  } catch (cause) {
    session = null;
    throw cause;
  }

  if (!options.replaceLocal && hasLocalWork()) {
    // Stop and ask. The caller shows the warning and calls again to confirm.
    session = null;
    return { session: { weddingId, ...keys }, needsConfirmation: true };
  }

  const entries: Array<[SuiteSlice, unknown]> = [];
  const slices: Record<string, Agreed> = {};
  for (const record of remote) {
    if (!record.ciphertext) continue;
    const value = await unseal(session.contentKey, record);
    entries.push([record.slice as SuiteSlice, value]);
    slices[record.slice] = { version: record.version, fingerprint: fingerprint(value) };
  }

  if (entries.length > 0) {
    useTrousseauStore.getState().setSlices(entries, { label: "opening the shared wedding" });
  }

  await save({ weddingId, salt, shareToken: null, slices, blobs: [] });
  await pullBlobs();
  return { session, needsConfirmation: false };
}

/** Is there anything here worth not throwing away? */
function hasLocalWork(): boolean {
  const { doc } = useTrousseauStore.getState();
  return Object.keys(doc.guests).length > 0 || Object.keys(readSeatingTables(doc)).length > 0;
}

function readSeatingTables(doc: { seating: unknown }): Record<string, unknown> {
  const seating = doc.seating;
  if (typeof seating !== "object" || seating === null) return {};
  const tables = (seating as Record<string, unknown>)["tables"];
  return typeof tables === "object" && tables !== null ? (tables as Record<string, unknown>) : {};
}

// the exchange ----------------------------------------------------------------

interface RemoteSlice extends Sealed {
  slice: string;
  version: number;
}

async function fetchSlices(weddingId: string): Promise<RemoteSlice[]> {
  const { slices } = await body<{ slices: RemoteSlice[] }>(
    await api(`wedding/${weddingId}/slices`),
  );
  return slices;
}

export interface Conflict {
  slice: string;
  /** Their value, decrypted and ready to apply if the user takes it. */
  theirs: unknown;
  theirVersion: number;
}

export interface SyncResult {
  /** Slices taken from the other machine. */
  pulled: string[];
  /** Slices sent. */
  pushed: string[];
  /** Changed in both places. Nothing was applied or sent for these. */
  conflicts: Conflict[];
  blobsUp: number;
  blobsDown: number;
}

/**
 * Take what is safe to take, send what is safe to send, and report the rest.
 *
 * Nothing is overwritten in either direction without the user saying so. A
 * slice changed only there is taken; one changed only here is sent; one changed
 * in both places is left exactly as it is on both machines and handed back as a
 * conflict for a person to settle.
 */
export async function sync(): Promise<SyncResult> {
  if (!session) throw new Error("Not signed in to a shared wedding.");
  const known = await membership();
  if (!known) throw new Error("This device is not part of a shared wedding.");

  const remote = await fetchSlices(session.weddingId);
  const byName = new Map(remote.map((r) => [r.slice, r]));

  const agreed = { ...known.slices };
  const take: Array<[SuiteSlice, unknown]> = [];
  const conflicts: Conflict[] = [];
  const pushed: string[] = [];

  for (const slice of SYNCED) {
    const record = byName.get(slice);
    const mine = localValue(slice);
    const base = agreed[slice];

    const changedHere = mine !== undefined && fingerprint(mine) !== (base?.fingerprint ?? null);
    const changedThere = (record?.version ?? 0) !== (base?.version ?? 0);

    if (changedThere && record?.ciphertext) {
      const theirs = await unseal(session.contentKey, record);
      if (changedHere) {
        conflicts.push({ slice, theirs, theirVersion: record.version });
        continue;
      }
      take.push([slice as SuiteSlice, theirs]);
      agreed[slice] = { version: record.version, fingerprint: fingerprint(theirs) };
      continue;
    }

    if (changedHere) {
      const result = await pushSlice(slice, mine, base?.version ?? 0);
      if (result.accepted) {
        agreed[slice] = { version: result.version, fingerprint: fingerprint(mine) };
        pushed.push(slice);
      } else {
        // The server moved between the read above and this write. Rare, and a
        // genuine conflict rather than staleness.
        const fresh = (await fetchSlices(session.weddingId)).find((r) => r.slice === slice);
        if (fresh?.ciphertext) {
          conflicts.push({
            slice,
            theirs: await unseal(session.contentKey, fresh),
            theirVersion: fresh.version,
          });
        }
      }
    }
  }

  if (take.length > 0) {
    useTrousseauStore.getState().setSlices(take, { label: "the other machine" });
  }

  const blobs = await syncBlobs(known.blobs);
  await save({ ...known, slices: agreed, blobs: blobs.known });

  return {
    pulled: take.map(([slice]) => slice),
    pushed,
    conflicts,
    blobsUp: blobs.uploaded,
    blobsDown: blobs.downloaded,
  };
}

async function pushSlice(
  slice: string,
  value: unknown,
  expectedVersion: number,
): Promise<{ accepted: boolean; version: number }> {
  if (!session) throw new Error("Not signed in.");
  const result = await body<{
    accepted: Array<{ slice: string; version: number }>;
    rejected: Array<{ slice: string; theirs: { version: number } }>;
  }>(
    await api(`wedding/${session.weddingId}/slices`, {
      method: "POST",
      body: JSON.stringify({
        writes: [{ slice, sealed: await seal(session.contentKey, value), expectedVersion }],
      }),
    }),
  );

  // The version comes back from the store. Assuming `expectedVersion + 1` was
  // right by luck rather than by contract.
  const landed = result.accepted.find((a) => a.slice === slice);
  if (landed) return { accepted: true, version: landed.version };
  return { accepted: false, version: result.rejected[0]?.theirs.version ?? expectedVersion };
}

// settling a conflict ---------------------------------------------------------

/** Take their version of one slice, discarding this machine's. */
export async function takeTheirs(conflict: Conflict): Promise<void> {
  const known = await membership();
  if (!known) return;
  useTrousseauStore
    .getState()
    .setSlices([[conflict.slice as SuiteSlice, conflict.theirs]], {
      label: `taking their ${conflict.slice}`,
    });
  await save({
    ...known,
    slices: {
      ...known.slices,
      [conflict.slice]: {
        version: conflict.theirVersion,
        fingerprint: fingerprint(conflict.theirs),
      },
    },
  });
}

/** Keep this machine's version, overwriting theirs on the server. */
export async function keepMine(conflict: Conflict): Promise<void> {
  const known = await membership();
  if (!known || !session) return;
  const mine = localValue(conflict.slice);
  const result = await pushSlice(conflict.slice, mine, conflict.theirVersion);
  if (!result.accepted) throw new Error("It changed again on the other machine. Sync and retry.");
  await save({
    ...known,
    slices: {
      ...known.slices,
      [conflict.slice]: { version: result.version, fingerprint: fingerprint(mine) },
    },
  });
}

// blobs -----------------------------------------------------------------------

/** Every uploaded asset the design references, by id. */
function referencedBlobs(): string[] {
  const design = readStationery(useTrousseauStore.getState().doc.stationery);
  const ids = new Set<string>(Object.keys(design.fonts));
  for (const element of design.template.elements) {
    if (element.kind === "image" && element.imageId) ids.add(element.imageId);
  }
  return [...ids];
}

/**
 * Fonts and artwork, encrypted like everything else.
 *
 * Without these the other machine opens a design referencing a file it has not
 * got — and the stationery export deliberately refuses to print a card with a
 * gap where a monogram should be, so the design would be unusable there.
 */
async function syncBlobs(
  knownOnServer: string[],
): Promise<{ uploaded: number; downloaded: number; known: string[] }> {
  if (!session) return { uploaded: 0, downloaded: 0, known: knownOnServer };

  const { ids } = await body<{ ids: string[] }>(await api(`wedding/${session.weddingId}/blobs`));
  const onServer = new Set(ids);
  const wanted = referencedBlobs();

  let uploaded = 0;
  for (const id of wanted) {
    if (onServer.has(id)) continue;
    const bytes = await getBlob(id);
    if (!bytes) continue;
    await body(
      await api(`wedding/${session.weddingId}/blob/${id}`, {
        method: "POST",
        body: JSON.stringify({ sealed: await sealBytes(session.contentKey, bytes) }),
      }),
    );
    onServer.add(id);
    uploaded += 1;
  }

  let downloaded = 0;
  for (const id of wanted) {
    if (await getBlob(id)) continue;
    if (!onServer.has(id)) continue;
    const sealed = await body<Sealed>(await api(`wedding/${session.weddingId}/blob/${id}`));
    await putBlob(id, await unsealBytes(session.contentKey, sealed));
    downloaded += 1;
  }

  return { uploaded, downloaded, known: [...onServer] };
}

/** After a join: fetch everything the design needs before it is first drawn. */
async function pullBlobs(): Promise<void> {
  const known = await membership();
  if (!known) return;
  const result = await syncBlobs(known.blobs);
  await save({ ...known, blobs: result.known });
}

// the guest link --------------------------------------------------------------

/**
 * Publish, replacing whatever was there.
 *
 * One token per wedding, kept in the membership. Minting a fresh one each time
 * left every previous link live for ever, still serving the plan as it was —
 * so removing somebody from the wedding never removed them from the internet.
 */
export async function publishShare(sealed: Sealed): Promise<string> {
  if (!session) throw new Error("Not signed in to a shared wedding.");
  const known = await membership();
  if (!known) throw new Error("This device is not part of a shared wedding.");

  const token = known.shareToken ?? crypto.randomUUID().replace(/-/g, "");
  await body(
    await api(`wedding/${session.weddingId}/share`, {
      method: "POST",
      body: JSON.stringify({ token, sealed }),
    }),
  );

  if (known.shareToken !== token) await save({ ...known, shareToken: token });
  return token;
}

export async function takeDownShare(): Promise<void> {
  if (!session) throw new Error("Not signed in to a shared wedding.");
  const known = await membership();
  if (!known?.shareToken) return;
  await body(
    await api(`wedding/${session.weddingId}/share/${known.shareToken}`, { method: "DELETE" }),
  );
  await save({ ...known, shareToken: null });
}
