"use client";

import { useTrousseauStore } from "@/lib/store/useTrousseauStore";

/**
 * The wedding, and how long there is.
 *
 * The date is the one fact that changes what everything else means: nine months
 * out an unseated guest is a note to self, and nine days out it is a problem.
 * Putting it at the top is the cheapest way to give the rest of the page that
 * weight without saying it in words.
 *
 * Days rather than a live clock. Nothing here is decided by the hour, and a
 * ticking number would only be something to watch.
 */
export function Countdown() {
  const couple = useTrousseauStore((s) => s.doc.event.coupleNames);
  const venue = useTrousseauStore((s) => s.doc.event.venueName);
  const date = useTrousseauStore((s) => s.doc.event.date);
  const status = useTrousseauStore((s) => s.status);

  if (status !== "ready") {
    return <div className="h-20 animate-pulse rounded-lg bg-stone" />;
  }

  return (
    <header>
      <h1 className="font-display text-4xl text-charcoal sm:text-5xl">
        {couple || "This wedding"}
      </h1>
      <p className="mt-3 text-lg text-slate">
        {venue && <span>{venue}</span>}
        {venue && date && <span className="px-2 text-charcoal/25">·</span>}
        {date && <span>{longDate(date)}</span>}
        {!venue && !date && <span>No date set yet. Add one in Timeline.</span>}
      </p>
      {date && <p className="mt-1 text-sm text-slate">{howLong(date)}</p>}
    </header>
  );
}

function longDate(iso: string): string {
  const when = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(when.getTime())) return iso;
  return when.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Counted in whole days from today, both directions.
 *
 * A wedding that has happened is not an error state — the plan is worth keeping
 * afterwards, for the thank-you letters and for whoever asks how it was done —
 * so the past is phrased as a fact rather than as something to fix.
 */
function howLong(iso: string): string {
  const when = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(when.getTime())) return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((when.getTime() - today.getTime()) / 86_400_000);

  if (days === 0) return "Today.";
  if (days === 1) return "Tomorrow.";
  if (days === -1) return "Yesterday.";
  if (days > 0) return `${days} days to go.`;
  return `${Math.abs(days)} days ago.`;
}
