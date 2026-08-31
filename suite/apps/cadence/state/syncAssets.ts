import { get, set } from "idb-keyval";
import { referencedKeys } from "./projectIO";
import { readSlice } from "./sliceBridge";

/**
 * Cadence's uploaded bytes, for the sync layer.
 *
 * Cadence lets you upload a typeface for the printed pieces and a monogram for
 * the head of the day sheet. Both live in its own IndexedDB store, keyed by a
 * hash of their contents, and the document holds only the keys — which is why
 * the day is small enough to email but also why the keys are useless on their
 * own. A second machine that has the document and not the bytes cannot render
 * the run sheet, and the export refuses to print a sheet with a hole in it
 * rather than quietly dropping the monogram.
 *
 * Which keys matter is Cadence's own question, and it already answers it:
 * `referencedKeys` is what its project export uses to decide what to bundle.
 * Asking the same function here means the two can never disagree about what a
 * day depends on.
 *
 * The reads and writes go through `idb-keyval` directly rather than through
 * `blobStore`, which offers no way to store bytes under a key it did not
 * compute itself. The keys are content hashes, so writing the same bytes back
 * under the key they arrived with is exactly what `blobStore` would have done.
 */

/** Prefixed so a Cadence blob can never collide with a Plaque font or image. */
const PREFIX = "cadence.blob.";

export interface PortableAsset {
  id: string;
  bytes: Uint8Array;
}

/** True for ids this module owns, so the aggregator knows where to send them. */
export function owns(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** Everything this day depends on, ready to encrypt and send. */
export async function collectAssets(): Promise<PortableAsset[]> {
  const out: PortableAsset[] = [];
  for (const key of referencedKeys(readSlice())) {
    const blob = await get<Blob>(key);
    if (!blob) continue;
    out.push({ id: PREFIX + key, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  return out;
}

/** The ids this machine already holds, so nothing is fetched twice. */
export async function heldAssetIds(): Promise<string[]> {
  const held: string[] = [];
  for (const key of referencedKeys(readSlice())) {
    if (await get<Blob>(key)) held.push(PREFIX + key);
  }
  return held;
}

/** Put a fetched asset back where Cadence expects it. */
export async function acceptAsset(id: string, bytes: Uint8Array): Promise<void> {
  if (!owns(id)) return;
  await set(id.slice(PREFIX.length), new Blob([bytes as BlobPart]));
}
