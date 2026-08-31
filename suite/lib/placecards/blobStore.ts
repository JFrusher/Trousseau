import { del, get, set } from "idb-keyval";

/**
 * Uploaded binaries: font files, images, SVG icons.
 *
 * IndexedDB, beside the document, and never inside it. A 300 KB font in the
 * JSON slice would be re-serialised on every keystroke and would blow past what
 * a browser will hold. The document stores ids and filenames; the bytes live
 * here, keyed by the same id.
 *
 * The consequence is that a restored backup can name an asset it does not have.
 * That is why filenames are kept in the document: an asset that has gone can at
 * least be reported by the name of the file to go and find.
 */

const PREFIX = "trousseau.blob.";

export async function putBlob(id: string, bytes: Uint8Array): Promise<void> {
  await set(PREFIX + id, bytes);
}

export async function getBlob(id: string): Promise<Uint8Array | null> {
  const found: unknown = await get(PREFIX + id);
  if (found instanceof Uint8Array) return found;
  // idb-keyval hands back whatever was stored; older writes may be a raw buffer.
  if (found instanceof ArrayBuffer) return new Uint8Array(found);
  return null;
}

export async function dropBlob(id: string): Promise<void> {
  await del(PREFIX + id);
}

/**
 * A stable id for some bytes, so the same file uploaded twice is stored once.
 *
 * FNV-1a over the content. Not a cryptographic hash and not meant to be — the
 * job is deduplication within one person's own uploads, where an adversary
 * choosing colliding inputs is not a threat that exists.
 */
export function contentId(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}${bytes.length.toString(16)}`;
}
