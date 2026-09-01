/** The height of a hanging label — must match `.hangingLabel` in BlockView.module.css. */
export const LABEL_PX = 17;

/**
 * How much of a block its box can hold. A box that can only show an ellipsis
 * shows nothing instead, and its name hangs beside it — see `placeLabels`.
 */
export type BlockDetail = "full" | "compact" | "name" | "outside";

export function blockDetail(heightPx: number): BlockDetail {
  if (heightPx >= 46) return "full";
  if (heightPx >= 28) return "compact";
  if (heightPx >= 16) return "name";
  return "outside";
}

export interface LabelBox {
  id: string;
  topPx: number;
  heightPx: number;
}

interface Span {
  topPx: number;
  bottomPx: number;
}

function clashes(candidate: Span, taken: Span[]): boolean {
  return taken.some((span) => candidate.topPx < span.bottomPx && span.topPx < candidate.bottomPx);
}

/**
 * Where each hanging label sits, in the column's pixel space.
 *
 * A label takes the free space directly after its block; failing that, the
 * space before it; failing both, it slides down then up from its block until
 * it finds room. Labels never overlap each other. A label never covers another
 * block's box unless the column has no free space at all, in which case it sits
 * on its own block as the least misleading place.
 */
export function placeLabels(
  boxes: LabelBox[],
  labelled: Set<string>,
  labelHeightPx: number,
  bottomPx: number,
): Map<string, number> {
  const ordered = [...boxes].sort((a, b) => a.topPx - b.topPx);
  const taken: Span[] = ordered.map((box) => ({
    topPx: box.topPx,
    bottomPx: box.topPx + box.heightPx,
  }));
  const placed = new Map<string, number>();

  for (const box of ordered) {
    if (!labelled.has(box.id)) continue;

    const after = box.topPx + box.heightPx;
    const before = box.topPx - labelHeightPx;
    const candidates = [after, before];

    let top: number | null = null;
    for (const candidate of candidates) {
      if (candidate < 0 || candidate + labelHeightPx > bottomPx) continue;
      if (clashes({ topPx: candidate, bottomPx: candidate + labelHeightPx }, taken)) continue;
      top = candidate;
      break;
    }

    if (top === null) {
      // Nothing free either side: try sliding down, then up.
      let slideDown = after;
      while (
        slideDown + labelHeightPx <= bottomPx &&
        clashes({ topPx: slideDown, bottomPx: slideDown + labelHeightPx }, taken)
      ) {
        slideDown += 1;
      }

      // If slideDown found a free slot within the column, use it
      if (slideDown + labelHeightPx <= bottomPx) {
        top = slideDown;
      } else {
        // slideDown ran out of column; try sliding up from the block
        let slideUp = box.topPx - labelHeightPx;
        while (
          slideUp >= 0 &&
          clashes({ topPx: slideUp, bottomPx: slideUp + labelHeightPx }, taken)
        ) {
          slideUp -= 1;
        }

        // If slideUp found a free slot, use it
        if (slideUp >= 0) {
          top = slideUp;
        } else {
          // Nothing free anywhere in the column: the label sits on its own block
          // rather than a stranger's. Only reachable when the day is zoomed out far
          // enough that no run of blocks has 17px of air in it.
          top = Math.max(0, Math.min(box.topPx, bottomPx - labelHeightPx));
        }
      }
    }

    placed.set(box.id, top);
    taken.push({ topPx: top, bottomPx: top + labelHeightPx });
  }

  return placed;
}
