"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, Redo2, Undo2, Users } from "lucide-react";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { useUndoKeys } from "@/lib/store/useUndoKeys";
import { TOOLS } from "@/lib/tools";
import { DataManager } from "./DataManager";

/**
 * The one header, on every page.
 *
 * The guest count sits in it deliberately: four tools reading one list is the
 * whole point of putting them together, and a number that moves when the
 * seating changes is the cheapest possible proof that they are.
 */
export function Header() {
  const [dataOpen, setDataOpen] = useState(false);
  const pathname = usePathname();
  const guestCount = useTrousseauStore((s) => Object.keys(s.doc.guests).length);
  const dirty = useTrousseauStore((s) => s.status === "error");
  const undo = useTrousseauStore((s) => s.undo);
  const redo = useTrousseauStore((s) => s.redo);
  const undoLabel = useTrousseauStore((s) => s.past[s.past.length - 1]?.label ?? null);
  const redoLabel = useTrousseauStore((s) => s.future[s.future.length - 1]?.label ?? null);

  useUndoKeys();

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-charcoal/10 bg-parchment/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-6">
          <Link href="/" className="shrink-0 font-display text-lg text-charcoal">
            Trousseau
          </Link>

          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {TOOLS.map((tool) => {
              const active = pathname === tool.href;
              return (
                <Link
                  key={tool.href}
                  href={tool.href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 rounded px-2.5 py-1.5 text-sm whitespace-nowrap transition ${
                    active
                      ? "bg-stone text-charcoal"
                      : "text-slate hover:bg-stone/60 hover:text-charcoal"
                  }`}
                >
                  {tool.name}
                </Link>
              );
            })}
          </nav>

          <div className="hidden shrink-0 items-center sm:flex">
            <button
              type="button"
              onClick={undo}
              disabled={undoLabel === null}
              title={undoLabel ? `Undo ${undoLabel}` : "Nothing to undo"}
              aria-label={undoLabel ? `Undo ${undoLabel}` : "Nothing to undo"}
              className="rounded p-1.5 text-slate transition hover:bg-stone hover:text-charcoal disabled:pointer-events-none disabled:opacity-30"
            >
              <Undo2 size={16} />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={redoLabel === null}
              title={redoLabel ? `Redo ${redoLabel}` : "Nothing to redo"}
              aria-label={redoLabel ? `Redo ${redoLabel}` : "Nothing to redo"}
              className="rounded p-1.5 text-slate transition hover:bg-stone hover:text-charcoal disabled:pointer-events-none disabled:opacity-30"
            >
              <Redo2 size={16} />
            </button>
          </div>

          <span
            title={`${guestCount} guests on this device`}
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-charcoal/10 bg-stone px-2.5 py-1 text-xs text-slate sm:inline-flex"
          >
            <Users size={13} />
            {guestCount}
          </span>

          <button
            type="button"
            onClick={() => setDataOpen(true)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-2.5 py-1.5 text-sm transition ${
              dirty
                ? "border-rose bg-rose/15 text-charcoal"
                : "border-charcoal/15 text-slate hover:border-gold hover:text-charcoal"
            }`}
          >
            <Database size={15} />
            <span className="hidden sm:inline">Data</span>
          </button>
        </div>
      </header>

      <DataManager open={dataOpen} onClose={() => setDataOpen(false)} />
    </>
  );
}
