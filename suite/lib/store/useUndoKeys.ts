"use client";

import { useEffect } from "react";
import { useTrousseauStore } from "./useTrousseauStore";

/**
 * Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, everywhere in the suite.
 *
 * Skipped while the focus is in a text field, where the browser's own undo is
 * what the user means — retyping a name should not roll back the seating plan.
 * A `contenteditable` counts as a field for the same reason.
 */
export function useUndoKeys(): void {
  const undo = useTrousseauStore((s) => s.undo);
  const redo = useTrousseauStore((s) => s.redo);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      if (isEditing(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
}

function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
