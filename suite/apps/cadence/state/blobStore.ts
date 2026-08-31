import { del, get, keys, set } from "idb-keyval";

/**
 * Uploaded bytes — a logo, a font — live in IndexedDB keyed by their content
 * hash. The document stores keys only, so it stays small enough to sit in
 * localStorage and to email as a `.cadence.json`.
 */
export interface BlobBackend {
  get(key: string): Promise<Blob | undefined>;
  set(key: string, value: Blob): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const idb: BlobBackend = {
  get: (key) => get<Blob>(key),
  set: (key, value) => set(key, value),
  del: (key) => del(key),
  keys: async () => (await keys()).map(String),
};

export async function contentKey(kind: string, bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .slice(0, 10)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${kind}-${hex}`;
}

/** Stores bytes and returns the key to put in the document. Same bytes, same key. */
export async function putBlob(
  kind: string,
  file: Blob,
  backend: BlobBackend = idb,
): Promise<string> {
  const bytes = await file.arrayBuffer();
  const key = await contentKey(kind, bytes);
  await backend.set(key, file);
  return key;
}

export async function getBlob(
  key: string,
  backend: BlobBackend = idb,
): Promise<Blob | null> {
  return (await backend.get(key)) ?? null;
}

export async function deleteBlob(key: string, backend: BlobBackend = idb): Promise<void> {
  await backend.del(key);
}

/**
 * Which of the keys a document references are not actually here. A project
 * file moved between machines arrives without its uploads; that is reported,
 * not thrown.
 */
export async function missingKeys(
  referenced: string[],
  backend: BlobBackend = idb,
): Promise<string[]> {
  const present = new Set(await backend.keys());
  return referenced.filter((key) => !present.has(key));
}

/** In-memory backend, for tests and for a browser with IndexedDB switched off. */
export function memoryBackend(): BlobBackend {
  const store = new Map<string, Blob>();
  return {
    get: async (key) => store.get(key),
    set: async (key, value) => void store.set(key, value),
    del: async (key) => void store.delete(key),
    keys: async () => [...store.keys()],
  };
}
