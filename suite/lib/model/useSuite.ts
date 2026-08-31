"use client";

import { useCallback } from "react";
import type { Event as WeddingEvent } from "@jfrusher/trousseau";
import {
  useTrousseauStore,
  type TrousseauState,
  type WriteOptions,
} from "@/lib/store/useTrousseauStore";
import {
  publishDay,
  readCrew,
  readGuests,
  readSeating,
  readTimeline,
  resolvedDay,
  timelineDoc,
} from "./slices";
import type { Crew, Guest, Seating } from "./types";
import type { Timeline } from "./timeline";

/**
 * What every tool reads and writes.
 *
 * Each reader goes through the per-document cache in `slices`, so a selector
 * returns the same object until the document actually changes — which is what
 * keeps these safe to call from a render.
 */

export const useEvent = (): WeddingEvent => useTrousseauStore((s) => s.doc.event);
export const useGuests = (): Record<string, Guest> =>
  useTrousseauStore((s) => readGuests(s.doc));
export const useSeating = (): Seating => useTrousseauStore((s) => readSeating(s.doc));
export const useTimeline = (): Timeline => useTrousseauStore((s) => readTimeline(s.doc));
export const useCrew = (): Crew => useTrousseauStore((s) => readCrew(s.doc));
export const useResolvedDay = () => useTrousseauStore((s) => resolvedDay(s.doc));
export const useTimelineDoc = () => useTrousseauStore((s) => timelineDoc(s.doc));
export const useStatus = (): TrousseauState["status"] => useTrousseauStore((s) => s.status);

/**
 * Every writer takes a `label`, which is what the undo tooltip says and what
 * consecutive edits coalesce on. An unlabelled write is still undoable — it
 * just reads as "change" and folds into nothing.
 */
export interface SuiteWriters {
  setEvent: (patch: Partial<WeddingEvent>, options?: WriteOptions) => void;
  setGuests: (next: Record<string, Guest>, options?: WriteOptions) => void;
  setSeating: (next: Seating, options?: WriteOptions) => void;
  /** Also republishes the resolved `day`, in the same change. */
  setTimeline: (next: Timeline, options?: WriteOptions) => void;
  setCrew: (next: Crew, options?: WriteOptions) => void;
  /** Both halves of a seat, as one undo step. */
  setPlan: (
    guests: Record<string, Guest>,
    seating: Seating,
    options?: WriteOptions,
  ) => void;
}

export function useWriters(): SuiteWriters {
  const setSlice = useTrousseauStore((s) => s.setSlice);
  const setSlices = useTrousseauStore((s) => s.setSlices);

  const setEvent = useCallback(
    (patch: Partial<WeddingEvent>, options: WriteOptions = { label: "wedding details" }) => {
      const { doc } = useTrousseauStore.getState();
      const event = { ...doc.event, ...patch };
      // The curfew is an input to the resolver, so moving it moves the day.
      setSlices(
        [
          ["event", event],
          ["day", publishDay({ ...doc, event }, readTimeline(doc))],
        ],
        options,
      );
    },
    [setSlices],
  );

  const setTimeline = useCallback(
    (next: Timeline, options: WriteOptions = { label: "the day" }) => {
      const { doc } = useTrousseauStore.getState();
      setSlices(
        [
          ["timeline", next],
          ["day", publishDay(doc, next)],
        ],
        options,
      );
    },
    [setSlices],
  );

  const setGuests = useCallback(
    (next: Record<string, Guest>, options: WriteOptions = { label: "the guest list" }) =>
      setSlice("guests", next, options),
    [setSlice],
  );
  const setSeating = useCallback(
    (next: Seating, options: WriteOptions = { label: "the room" }) =>
      setSlice("seating", next, options),
    [setSlice],
  );
  const setCrew = useCallback(
    (next: Crew, options: WriteOptions = { label: "the crew" }) => setSlice("crew", next, options),
    [setSlice],
  );
  const setPlan = useCallback(
    (
      guests: Record<string, Guest>,
      seating: Seating,
      options: WriteOptions = { label: "the seating" },
    ) =>
      setSlices(
        [
          ["guests", guests],
          ["seating", seating],
        ],
        options,
      ),
    [setSlices],
  );

  return { setEvent, setGuests, setSeating, setTimeline, setCrew, setPlan };
}
