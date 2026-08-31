"use client";

import { Redo2, Undo2 } from "lucide-react";
import { ChromeFill } from "./chrome";

/**
 * The undo control in the header, driven by whichever tool is on screen.
 *
 * One pair of buttons rather than four, because two undo buttons on one screen
 * is worse than either alone — and the shell's own pair was the misleading one,
 * since the tools write their slices silently and the document's history never
 * saw the edit you had just made.
 *
 * The tool passes its own state in. Nothing is unified about *how* undo works:
 * Plaque keeps snapshots, Cadence and Brigade share a history module, Tableaux
 * replays inverse commands, and all four are right for what they do. Only the
 * button is shared, so that undo is in the same place wherever you are.
 */
export function ToolUndo({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  undoLabel,
  redoLabel,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** What the next undo would take back, when the tool can say. */
  undoLabel?: string | null;
  redoLabel?: string | null;
}) {
  const undoText = canUndo ? `Undo${undoLabel ? ` ${undoLabel}` : ""}` : "Nothing to undo";
  const redoText = canRedo ? `Redo${redoLabel ? ` ${redoLabel}` : ""}` : "Nothing to redo";

  return (
    <ChromeFill name="tool-undo">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title={undoText}
        aria-label={undoText}
        className="rounded p-1.5 text-slate transition hover:bg-stone hover:text-charcoal disabled:pointer-events-none disabled:opacity-30"
      >
        <Undo2 size={16} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title={redoText}
        aria-label={redoText}
        className="rounded p-1.5 text-slate transition hover:bg-stone hover:text-charcoal disabled:pointer-events-none disabled:opacity-30"
      >
        <Redo2 size={16} />
      </button>
    </ChromeFill>
  );
}
