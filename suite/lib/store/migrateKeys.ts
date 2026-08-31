import { del, get, keys, set } from "idb-keyval";

/**
 * Moving stored data to the keys the app uses now that it is called Trousseau.
 *
 * It was briefly called Tableaux Suite — a name it shared with one of the four
 * apps it replaced. Renaming the storage keys without this would not lose the
 * data, which is the mercy: the old entries stay in IndexedDB untouched. But
 * nothing would look at them, so the app would open to an empty wedding, which
 * a person cannot tell apart from having lost everything.
 *
 * Runs once, before the first read. Copies rather than moves until the write
 * has succeeded, so an interrupted migration leaves the old copy intact.
 */

const MOVES: Array<[from: string, to: string]> = [
  ["tableaux.suite.document", "trousseau.document"],
  ["tableaux.suite.sync", "trousseau.sync"],
];

/** Uploaded fonts and artwork, which are one key each. */
const BLOB_PREFIX_FROM = "tableaux.suite.blob.";
const BLOB_PREFIX_TO = "trousseau.blob.";

export interface MigrationResult {
  moved: string[];
}

export async function migrateLegacyKeys(): Promise<MigrationResult> {
  const moved: string[] = [];

  for (const [from, to] of MOVES) {
    // Never overwrite: if the new key already holds something, this device has
    // already migrated, and the stale old copy is not the truth.
    if ((await get(to)) !== undefined) continue;
    const value: unknown = await get(from);
    if (value === undefined) continue;

    await set(to, value);
    await del(from);
    moved.push(to);
  }

  for (const key of await keys()) {
    if (typeof key !== "string" || !key.startsWith(BLOB_PREFIX_FROM)) continue;
    const to = BLOB_PREFIX_TO + key.slice(BLOB_PREFIX_FROM.length);
    if ((await get(to)) !== undefined) {
      await del(key);
      continue;
    }
    const value: unknown = await get(key);
    if (value === undefined) continue;

    await set(to, value);
    await del(key);
    moved.push(to);
  }

  return { moved };
}
