import { mayWrite, noteRead } from "@/lib/store/toolGeneration";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import type { Persisted } from "./persist";

/**
 * Where Plaque's autosave actually lands.
 *
 * This is the whole adaptation. Plaque was a standalone app that owned its own
 * IndexedDB key; here it is one tool among four, and its work belongs in the
 * `stationery` slice of the shared wedding — so it travels with the backup, the
 * sync and everything else, instead of being a second thing to remember.
 *
 * Nothing above this file knows. The store, the nine panels, the undo history,
 * the "restored from 13:42" notice are all Plaque's own code, unchanged. The
 * only edit to `persist.ts` is which two functions the bytes pass through.
 *
 * Synchronous on purpose: `persist.save` is called from an unload handler,
 * where a promise is not guaranteed to settle. The shared store's own write is
 * debounced and flushed on unload, so handing it the value is enough.
 */

/** The autosave, or null when this wedding has no stationery yet. */
export function readSlice(): Persisted | null {
  noteRead("plaque");
  const raw = useTrousseauStore.getState().raw["stationery"];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  // A slice with no version was written by something other than Plaque's
  // autosave — an empty envelope, most likely. Treated as absent rather than
  // fed to a loader that expects a shape it does not have.
  return "version" in raw ? (raw as unknown as Persisted) : null;
}

export function writeSlice(record: Persisted | null): void {
  // Refused when the document has been replaced since this was read — see
  // `toolGeneration`. Writing here would put the previous wedding back.
  if (!mayWrite("plaque")) return;
  useTrousseauStore
    .getState()
    .setSlice("stationery", record ?? {}, { label: "the stationery", silent: true });
}
