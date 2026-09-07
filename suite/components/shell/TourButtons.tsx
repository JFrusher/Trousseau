"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Compass, HelpCircle } from "lucide-react";
import { chapterForRoute } from "@/lib/tour/steps";
import { useTour } from "@/lib/tour/useTour";
import { isWeddingEmpty, loadExampleWedding } from "@/lib/tour/exampleWedding";

/**
 * The two ways in.
 *
 * Deliberately only two. A tour offered from everywhere is an interruption;
 * one offered nowhere is never found.
 */

/** The front page: start at the beginning, optionally on the example wedding. */
export function TakeTheTour() {
  const { start, hasSeenTour } = useTour();
  const [busy, setBusy] = useState(false);

  async function begin(withExample: boolean) {
    setBusy(true);
    try {
      if (withExample && (await loadExampleWedding()) === "cancelled") return;
      start("shell");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-charcoal/10 pt-4">
      <button
        type="button"
        disabled={busy}
        onClick={() => void begin(false)}
        className="inline-flex items-center gap-2 rounded border border-gold bg-gold/15 px-3 py-2 text-sm text-charcoal transition hover:bg-gold/25 disabled:opacity-50"
      >
        <Compass size={15} />
        {hasSeenTour ? "Take the tour again" : "Take a tour"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void begin(true)}
        className="inline-flex items-center gap-2 rounded border border-charcoal/15 px-3 py-2 text-sm text-slate transition hover:border-gold hover:text-charcoal disabled:opacity-50"
      >
        {isWeddingEmpty()
          ? "Fill it with an example wedding"
          : "Replace this with the example wedding"}
      </button>
    </div>
  );
}

/** The header: explain the tool currently open. */
export function HowThisWorks() {
  const { start } = useTour();
  const pathname = usePathname();

  return (
    <button
      type="button"
      onClick={() => start(chapterForRoute(pathname))}
      title="How this page works"
      aria-label="How this page works"
      className="inline-flex shrink-0 items-center rounded border border-charcoal/15 p-1.5 text-slate transition hover:border-gold hover:text-charcoal"
    >
      <HelpCircle size={15} />
    </button>
  );
}
