"use client";

import Link from "next/link";
import { useShallow } from "zustand/shallow";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { readCrew, readGuests, readSeating, readTimeline } from "@/lib/model/slices";
import { TOOLS } from "@/lib/tools";

/**
 * What is actually on this device, right now.
 *
 * A landing page that talks about local-first and then shows nothing local is
 * an advertisement. This is the proof, and on a first visit it is honest about
 * being empty rather than seeding a demo the user then has to clear out.
 */
export function QuickStats() {
  const status = useTrousseauStore((s) => s.status);
  // `useShallow`, because this selector builds a fresh object every call and a
  // new reference on every render is an infinite update loop under
  // `useSyncExternalStore`, not merely a wasted render.
  const stats = useTrousseauStore(
    useShallow((s) => {
    const guests = readGuests(s.doc);
    const seated = Object.values(guests).filter((g) => g.assignedTableId !== null).length;
    return {
      couple: s.doc.event.coupleNames,
      date: s.doc.event.date,
      guests: Object.keys(guests).length,
      seated,
      tables: Object.keys(readSeating(s.doc).tables).length,
      blocks: readTimeline(s.doc).blocks.length,
      jobs: readCrew(s.doc).jobs.length,
      savedAt: s.savedAt,
      };
    }),
  );

  if (status === "loading" || status === "idle") {
    return <div className="h-40 animate-pulse rounded-lg bg-stone" />;
  }

  const empty = stats.guests === 0 && stats.tables === 0 && stats.blocks === 0;

  return (
    <div className="rounded-lg border border-charcoal/10 bg-stone/60 p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl">{stats.couple || "On this device"}</h2>
        {stats.date ? <span className="text-sm text-slate">{stats.date}</span> : null}
      </div>

      {empty ? (
        <p className="text-sm text-slate">
          Nothing saved here yet. Open{" "}
          <span className="text-charcoal">Data</span> in the header to upload a guest list, or
          start in <Link href="/seating" className="text-charcoal underline decoration-gold">Seating</Link>.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Guests" value={stats.guests} href="/seating" />
          <Stat label="Seated" value={`${stats.seated} / ${stats.guests}`} href="/place-cards" />
          <Stat label="Tables" value={stats.tables} href="/seating" />
          <Stat label="Day blocks" value={stats.blocks} href="/timeline" />
        </dl>
      )}

      <p className="mt-5 border-t border-charcoal/10 pt-4 text-xs text-slate">
        {stats.savedAt
          ? `Saved to this browser at ${new Date(stats.savedAt).toLocaleTimeString()}.`
          : "Saved to this browser as you work."}{" "}
        Export a backup from the Data button — it is the only copy that survives clearing the
        browser.
      </p>

      <nav className="mt-5 grid gap-2 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group flex items-start gap-3 rounded border border-charcoal/10 bg-parchment p-3 transition hover:border-gold"
          >
            <tool.icon size={18} className="mt-0.5 shrink-0 text-gold" />
            <span>
              <span className="block text-sm text-charcoal">{tool.name}</span>
              <span className="block text-xs text-slate">{tool.tagline}</span>
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href} className="block">
      <dt className="text-xs tracking-widest text-slate uppercase">{label}</dt>
      <dd className="font-display text-3xl text-charcoal">{value}</dd>
    </Link>
  );
}
