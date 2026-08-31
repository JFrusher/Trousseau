import { publishDay, readTimeline } from "@/lib/model/slices";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import type { TimelineDoc } from "../core/model/types";

/**
 * Where Cadence's autosave actually lands.
 *
 * Cadence was a standalone app that owned a localStorage key; here it is one
 * tool among four, and the day it plans is the same day the delegation board
 * hands out and the place cards are printed for. So its document lives in the
 * shared wedding's `timeline` slice instead.
 *
 * Nothing above this file knows. The store, the panels, the undo history, the
 * drag-to-move blocks are all Cadence's own code, unchanged — only the two
 * functions in `persist.ts` point somewhere new.
 *
 * Two things happen on every write that did not happen in standalone Cadence,
 * both because other tools are now reading:
 *
 *  - The resolved day is republished. `timeline` holds the *source* — anchors,
 *    gaps, squeeze floors — and `day` holds what those work out to. The
 *    delegation board reads the second, so leaving it stale would have it
 *    handing out yesterday's times.
 *
 *  - Five fields are mirrored back into `event`. The date, the couple, the
 *    venue, the curfew and the UTC offset belong to the wedding rather than to
 *    Cadence, which keeps an echo of them for its own resolver. The envelope's
 *    copy wins on read, so without this the Day panel would appear to accept an
 *    edit and then quietly revert to the old date on the next load.
 */

/** The day as Cadence wants it, with the envelope's own fields already applied. */
export function readSlice(): TimelineDoc {
  return readTimeline(useTrousseauStore.getState().doc);
}

export function writeSlice(next: TimelineDoc): void {
  const store = useTrousseauStore.getState();
  const { doc } = store;

  store.setSlices(
    [
      ["timeline", next],
      ["day", publishDay(doc, next)],
      [
        "event",
        {
          ...doc.event,
          date: next.day.date,
          coupleNames: next.day.coupleNames,
          venueName: next.day.venueName,
          curfewMin: next.day.curfewMin,
          utcOffsetMin: next.day.utcOffsetMin,
        },
      ],
    ],
    { label: "the day", silent: true },
  );
}
