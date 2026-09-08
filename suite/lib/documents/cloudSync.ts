import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";

/**
 * The offline write queue and cloud transport, kept entirely separate from
 * `useTrousseauStore` so it can be tested with a fake `fetch` and a mocked
 * `idb-keyval`, the same way `persistFailure.test.ts` tests the local store's
 * own IndexedDB failure handling.
 *
 * One document per wedding, saved as a whole snapshot rather than an
 * operation log, means the "offline queue" the spec describes is correctly a
 * queue of at most one pending write — see this file's task in the plan for
 * why that is a property of the data model, not a corner cut.
 */

const PENDING_WRITE_KEY = "trousseau.cloud.pendingWrite";

export interface PendingWrite {
  document: unknown;
  expectedVersion: number;
}

export async function getPendingWrite(): Promise<PendingWrite | null> {
  const value = await idbGet(PENDING_WRITE_KEY);
  return (value as PendingWrite | undefined) ?? null;
}

export async function queueWrite(document: unknown, expectedVersion: number): Promise<void> {
  await idbSet(PENDING_WRITE_KEY, { document, expectedVersion } satisfies PendingWrite);
}

export async function clearPendingWrite(): Promise<void> {
  await idbDel(PENDING_WRITE_KEY);
}

export type FetchResult =
  | { ok: true; document: unknown; version: number }
  | { ok: false; reason: "unreachable" | "unavailable" };

/** Reads the caller's current cloud document. Never throws. */
export async function fetchCloudDocument(): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch("/api/documents", { method: "GET" });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (!response.ok) return { ok: false, reason: "unavailable" };
  const body = (await response.json()) as { document: unknown; version: number };
  return { ok: true, document: body.document, version: body.version };
}

export type PushResult =
  | { ok: true; version: number; warnings: string[] }
  | { ok: false; reason: "queued" }
  | { ok: false; reason: "conflict"; version: number; document: unknown }
  | { ok: false; reason: "invalid"; errors: string[] }
  | { ok: false; reason: "unavailable" };

/**
 * Attempt a write immediately. A network failure queues it (replacing
 * whatever was queued before) rather than dropping it — everything else
 * (a conflict, a validation failure, the deployment not being configured) is
 * a real answer from the server and is surfaced as-is, not queued for silent
 * retry: retrying a rejected write without the user reapplying anything
 * would just be rejected again.
 */
export async function pushDocument(document: unknown, expectedVersion: number): Promise<PushResult> {
  let response: Response;
  try {
    response = await fetch("/api/documents", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document, expectedVersion }),
    });
  } catch {
    await queueWrite(document, expectedVersion);
    return { ok: false, reason: "queued" };
  }

  if (response.status === 200) {
    await clearPendingWrite();
    const body = (await response.json()) as { version: number; warnings: string[] };
    return { ok: true, version: body.version, warnings: body.warnings };
  }
  if (response.status === 409) {
    await clearPendingWrite();
    const body = (await response.json()) as { version: number; document: unknown };
    return { ok: false, reason: "conflict", version: body.version, document: body.document };
  }
  if (response.status === 422) {
    await clearPendingWrite();
    const body = (await response.json()) as { errors: string[] };
    return { ok: false, reason: "invalid", errors: body.errors };
  }
  return { ok: false, reason: "unavailable" };
}

/**
 * Replay a queued write, if one exists. Called on reconnect. A queued write
 * that itself now conflicts is handled identically to any other conflict —
 * `pushDocument` already does that — rather than a second conflict path
 * invented for the offline case specifically.
 */
export async function replayPendingWrite(): Promise<PushResult | null> {
  const pending = await getPendingWrite();
  if (!pending) return null;
  return pushDocument(pending.document, pending.expectedVersion);
}

export interface WeddingIdResult {
  ok: boolean;
  weddingId: string | null;
}

/** The caller's wedding id, or null if there isn't one yet. Never throws. */
export async function fetchWeddingId(): Promise<WeddingIdResult> {
  try {
    const response = await fetch("/api/accounts/wedding");
    if (!response.ok) return { ok: false, weddingId: null };
    const body = (await response.json()) as { weddingId: string | null };
    return { ok: true, weddingId: body.weddingId };
  } catch {
    return { ok: false, weddingId: null };
  }
}
