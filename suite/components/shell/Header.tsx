"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, Users } from "lucide-react";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { TOOLS } from "@/lib/tools";
import { AccountStatus } from "./AccountStatus";
import { ChromeSlot } from "./chrome";
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

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-charcoal/10 bg-parchment/95 backdrop-blur">
        <div className="mx-auto flex h-[var(--shell-header-h)] max-w-7xl items-center gap-2 px-4 sm:gap-6">
          <Link href="/" className="shrink-0 font-display text-lg text-charcoal">
            Trousseau
          </Link>

          <nav className="flex shrink-0 items-center gap-1">
            {TOOLS.map((tool) => {
              const active = pathname === tool.href;
              return (
                <Link
                  key={tool.href}
                  href={tool.href}
                  aria-current={active ? "page" : undefined}
                  className={`${tool.tokens} shrink-0 rounded-t border-b-2 px-2.5 py-1.5 text-sm whitespace-nowrap transition ${
                    active
                      ? "border-[var(--accent-bright)] bg-stone text-charcoal"
                      : "border-transparent text-slate hover:bg-stone/60 hover:text-charcoal"
                  }`}
                >
                  {tool.name}
                </Link>
              );
            })}
          </nav>

          {/*
            * The tool on screen fills these. Undo belongs to whichever tool you
            * are editing in — it is the only thing that knows what your last
            * change was — and its document controls sit beside it rather than
            * on a second bar of their own.
            */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto [&_button]:whitespace-nowrap [&>*]:shrink-0">
            <ChromeSlot name="tool-actions" />
          </div>
          <div className="hidden shrink-0 items-center sm:flex">
            <ChromeSlot name="tool-undo" />
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

          <AccountStatus />
        </div>
      </header>

      <DataManager open={dataOpen} onClose={() => setDataOpen(false)} />
    </>
  );
}
