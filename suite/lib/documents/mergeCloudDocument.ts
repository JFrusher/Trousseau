import { SLICE_NAMES, type SliceName } from "@jfrusher/trousseau";
import { fingerprint } from "./fingerprint";

/**
 * Per-slice merge over a whole-document compare-and-set store.
 *
 * The server holds one JSONB document with one version (lib/documents), not
 * one row per slice — but two partners editing different parts of the same
 * wedding in the same window should not have to choose between their edits
 * just because *some* slice moved. This runs the same three-way comparison
 * lib/sync/client.ts's sync() does for its per-slice tables, entirely
 * client-side, before the next whole-document write.
 */

export interface SliceConflict {
  slice: SliceName;
  /** The server's value for this slice, ready to apply if the user takes it. */
  theirs: unknown;
}

export interface MergeResult {
  /** Ready to become the new local raw document. */
  raw: Record<string, unknown>;
  /** Slices that changed on both sides. Untouched in `raw` - still local's value. */
  conflicts: SliceConflict[];
  /** Updated agreed-fingerprint map: includes every slice that is now settled. */
  agreed: Partial<Record<SliceName, string>>;
}

export function fingerprintAllSlices(raw: Record<string, unknown>): Partial<Record<SliceName, string>> {
  const agreed: Partial<Record<SliceName, string>> = {};
  for (const slice of SLICE_NAMES) agreed[slice] = fingerprint(raw[slice]);
  return agreed;
}

export function mergeCloudDocument(
  localRaw: Record<string, unknown>,
  serverRaw: Record<string, unknown>,
  agreedFingerprints: Partial<Record<SliceName, string>>,
): MergeResult {
  const raw = { ...localRaw };
  const agreed = { ...agreedFingerprints };
  const conflicts: SliceConflict[] = [];

  for (const slice of SLICE_NAMES) {
    const mine = localRaw[slice];
    const theirs = serverRaw[slice];
    const mineFp = fingerprint(mine);
    const theirFp = fingerprint(theirs);

    if (mineFp === theirFp) {
      agreed[slice] = mineFp;
      continue;
    }

    const base = agreedFingerprints[slice];
    const changedHere = mineFp !== base;
    const changedThere = theirFp !== base;

    if (changedHere && changedThere) {
      conflicts.push({ slice, theirs });
      continue; // raw[slice] stays at localRaw[slice]; agreed[slice] stays at base.
    }

    if (changedThere) {
      raw[slice] = theirs;
      agreed[slice] = theirFp;
      continue;
    }

    // changedHere only: keep mine. Left unmarked in `agreed` (still `base`) -
    // the next successful push (Task 3) recomputes the full agreed map from
    // whatever was actually accepted, which is the one true source for it.
  }

  return { raw, conflicts, agreed };
}
