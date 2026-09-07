"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CHAPTERS, type ChapterId, type TourStep } from "./steps";

/**
 * Which chapter and step are open.
 *
 * Held in a context mounted in `app/(app)/layout.tsx`, which persists across
 * client-side navigation — so a chapter that moves the user from Seating to
 * Timeline keeps its place without any extra machinery.
 */

const SEEN_KEY = "trousseau.tour.seen";

/** Storage can throw outright in a private window, so every touch is wrapped. */
function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // A browser refusing storage means the tour is offered again next time,
    // which is a far better failure than not opening at all.
  }
}

export interface TourState {
  /** Null when the tour is closed. */
  step: TourStep | null;
  chapterTitle: string;
  /** One-based, for "3 of 5". */
  index: number;
  total: number;
  start: (chapter: ChapterId) => void;
  next: () => void;
  back: () => void;
  stop: () => void;
  hasSeenTour: boolean;
}

const TourContext = createContext<TourState | null>(null);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ chapter: ChapterId; index: number } | null>(null);
  const [seen, setSeen] = useState(false);

  const chapter = open ? CHAPTERS.find((c) => c.id === open.chapter) : undefined;
  const step = chapter?.steps[open?.index ?? 0] ?? null;

  const go = useCallback(
    (next: { chapter: ChapterId; index: number } | null) => {
      setOpen(next);
      if (!next) return;
      const target = CHAPTERS.find((c) => c.id === next.chapter)?.steps[next.index];
      // Steps carry their own route so a chapter can walk between tools.
      if (target && window.location.pathname !== target.route) router.push(target.route);
    },
    [router],
  );

  const start = useCallback(
    (id: ChapterId) => {
      setSeen(true);
      writeSeen();
      go({ chapter: id, index: 0 });
    },
    [go],
  );

  const next = useCallback(() => {
    if (!open || !chapter) return;
    // The last step of a chapter ends the tour rather than rolling into the
    // next one. Somebody who opened "How this works" on Place cards asked
    // about Place cards, not about everything.
    if (open.index + 1 >= chapter.steps.length) go(null);
    else go({ chapter: open.chapter, index: open.index + 1 });
  }, [chapter, go, open]);

  const back = useCallback(() => {
    if (!open || open.index === 0) return;
    go({ chapter: open.chapter, index: open.index - 1 });
  }, [go, open]);

  const stop = useCallback(() => go(null), [go]);

  const value = useMemo<TourState>(
    () => ({
      step,
      chapterTitle: chapter?.title ?? "",
      index: (open?.index ?? 0) + 1,
      total: chapter?.steps.length ?? 0,
      start,
      next,
      back,
      stop,
      hasSeenTour: seen || (typeof window !== "undefined" && readSeen()),
    }),
    [back, chapter, next, open, seen, start, step, stop],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

/** Throws outside the provider, which is a wiring mistake rather than a user-facing one. */
export function useTour(): TourState {
  const value = useContext(TourContext);
  if (!value) throw new Error("useTour must be used inside <TourProvider>");
  return value;
}
