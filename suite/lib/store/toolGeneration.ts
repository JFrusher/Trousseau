import { useTrousseauStore } from "./useTrousseauStore";

/**
 * Stops a tool writing a wedding that has since been replaced.
 *
 * Each of the four keeps a store of its own, filled once when it mounts. That
 * is right — it is what lets them keep their own undo history and their own
 * idea of what is selected — but it means a tool holds a copy, and a copy goes
 * stale the moment the whole document is swapped underneath it by a restore
 * from file or a shared wedding opened from elsewhere.
 *
 * Showing the old data is the visible half of that problem, and remounting the
 * tool fixes it. This is the other half, which is worse for being quiet: the
 * stale instance is still wired to an autosave, and on its way out it writes
 * the wedding it was holding over the one that just arrived. Ninety-seven
 * guests replaced by the four that were there before the restore, with a
 * "Restored" message still on screen saying it worked.
 *
 * So a tool records which generation it read, and its writes are refused if the
 * document has moved on. Refused rather than merged: what it is holding is not
 * a newer version of the wedding, it is an older one that has not noticed.
 */

const readAt = new Map<string, number>();

/** Call when a tool takes its copy of the document. */
export function noteRead(tool: string): void {
  readAt.set(tool, useTrousseauStore.getState().generation);
}

/**
 * Whether this tool's copy is still of the current document.
 *
 * A tool that has never read anything may write: that is a fresh mount whose
 * own read is about to happen, and refusing there would lose real edits.
 */
export function mayWrite(tool: string): boolean {
  const seen = readAt.get(tool);
  return seen === undefined || seen === useTrousseauStore.getState().generation;
}
