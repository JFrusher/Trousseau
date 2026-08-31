import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";

/** Drags land on five-minute marks; a wedding is not planned to the second. */
export const SNAP_MIN = 5;

/** Pixels dragged to minutes moved, snapped. */
export function minutesFromDelta(dx: number, pxPerMin: number, snapMin = SNAP_MIN): number {
  if (pxPerMin <= 0) return 0;
  return Math.round(dx / pxPerMin / snapMin) * snapMin;
}

export interface DragState {
  blockId: string;
  deltaMin: number;
}

/**
 * Horizontal drag on a block. Every pointer move runs a what-if against a copy
 * of the document; nothing is committed until the pointer comes up, and Escape
 * throws the whole thing away.
 */
export function useDragBlock(pxPerMin: number) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const origin = useRef(0);
  const previewChange = useStore((state) => state.previewChange);
  const commitPreview = useStore((state) => state.commitPreview);
  const cancelPreview = useStore((state) => state.cancelPreview);

  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent) => {
      const deltaMin = minutesFromDelta(event.clientX - origin.current, pxPerMin);
      setDrag((current) => (current ? { ...current, deltaMin } : current));
      previewChange({ type: "shift", blockId: drag.blockId, deltaMin });
    };

    const onUp = () => {
      commitPreview();
      setDrag(null);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      cancelPreview();
      setDrag(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [drag, pxPerMin, previewChange, commitPreview, cancelPreview]);

  const start = (blockId: string, clientX: number) => {
    origin.current = clientX;
    setDrag({ blockId, deltaMin: 0 });
  };

  return { drag, start };
}
