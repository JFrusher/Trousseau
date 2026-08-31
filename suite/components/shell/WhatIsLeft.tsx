"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { readiness } from "@/lib/model/readiness";
import { TOOLS } from "@/lib/tools";

/**
 * The one list of what is still to do, across the whole wedding.
 *
 * Only the gaps between the tools. Each of the four already checks its own work
 * and says so in its own footer, and repeating that here would mean fixing a
 * thing in one place and watching it sit unfixed in the other.
 *
 * Every row goes somewhere. A list of problems with no way to act on them is a
 * worse version of not having the list.
 */
export function WhatIsLeft() {
  const doc = useTrousseauStore((s) => s.doc);
  const raw = useTrousseauStore((s) => s.raw);
  const status = useTrousseauStore((s) => s.status);

  const items = useMemo(() => readiness(doc, raw), [doc, raw]);

  if (status !== "ready") return null;

  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded border border-sage/40 bg-sage/10 px-4 py-3 text-sm text-charcoal">
        <Check size={16} className="shrink-0 text-sage" />
        Nothing left that spans the tools. Each one will tell you about its own work.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => {
        const tool = TOOLS.find((entry) => entry.href === item.href);
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className={`${tool?.tokens ?? ""} group flex items-center gap-3 rounded border px-4 py-3 transition ${
                item.severity === "blocking"
                  ? "border-rose/40 bg-rose/10 hover:border-rose"
                  : "border-charcoal/10 bg-stone/50 hover:border-charcoal/25"
              }`}
            >
              <AlertTriangle
                size={16}
                className={`shrink-0 ${item.severity === "blocking" ? "text-rose" : "text-slate"}`}
              />
              <span className="min-w-0 flex-1 text-sm text-charcoal">{item.message}</span>
              <span className="hidden shrink-0 items-center gap-1 text-xs text-slate group-hover:text-charcoal sm:flex">
                {item.action}
                <ArrowRight size={13} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
