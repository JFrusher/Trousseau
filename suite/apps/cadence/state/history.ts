/**
 * Snapshot undo. A timeline document is a couple of hundred small objects, so
 * copying one costs less than the bookkeeping a command stack would need.
 * ponytail: snapshots, capped at 50. Swap for command objects only if
 * documents grow large enough for the copies to show up in a profile.
 */

export const HISTORY_LIMIT = 50;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Records a new present. A fresh edit abandons any redo path. */
export function push<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    future: [],
  };
}

/** Replaces the present without touching history — for loading a file. */
export function reset<T>(present: T): History<T> {
  return initHistory(present);
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}
