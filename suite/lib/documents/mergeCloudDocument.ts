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
  /**
   * True when any value in `raw` came from the server rather than from local.
   *
   * A caller that replaces the document unconditionally makes every accepted
   * server write bounce straight back — a version bump and a history row for a
   * document nobody changed, which the *other* tab then pulls and bounces
   * again. It also remounts the whole tool subtree (keyed on `generation`) on
   * both devices every poll. So: replace and push only when this is true.
   */
  adopted: boolean;
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
  // Seeded from the server, then overlaid with local, so a top-level key this
  // build has never heard of — a slice belonging to a tool a newer version of
  // the suite added — defaults to the server's copy instead of vanishing from
  // the merged document and then being pushed back missing. The contract's
  // envelope uses `looseObject` for exactly this reason. Every known slice is
  // decided by the loop below, which writes `raw[slice]` on every branch.
  const raw: Record<string, unknown> = { ...serverRaw, ...localRaw };
  const agreed = { ...agreedFingerprints };
  const conflicts: SliceConflict[] = [];
  let adopted = Object.keys(serverRaw).some(
    (key) => !(key in localRaw) && !(SLICE_NAMES as readonly string[]).includes(key),
  );

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
      raw[slice] = mine; // Local's value stands until the user chooses.
      continue; // agreed[slice] stays at base.
    }

    if (changedThere) {
      raw[slice] = theirs;
      agreed[slice] = theirFp;
      adopted = true;
      continue;
    }

    // changedHere only: keep mine. Left unmarked in `agreed` (still `base`) -
    // the next successful push (Task 3) recomputes the full agreed map from
    // whatever was actually accepted, which is the one true source for it.
    raw[slice] = mine;
  }

  return { raw, conflicts, agreed, adopted };
}
