"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { IconButton, TextField } from "@/components/ui/controls";
import { guestName } from "@/lib/model/slices";
import type { Guest } from "@/lib/model/types";

/** A search-as-you-type list of guests, for picking one or several. */
export function GuestPicker({
  guests,
  exclude = [],
  onPick,
}: {
  guests: Record<string, Guest>;
  /** Ids already chosen elsewhere in this picker, hidden from the list. */
  exclude?: string[];
  onPick: (guestId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const excluded = useMemo(() => new Set(exclude), [exclude]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    return Object.values(guests)
      .filter((g) => !excluded.has(g.id))
      .filter((g) => guestName(g).toLowerCase().includes(q))
      .sort((a, b) => guestName(a).localeCompare(guestName(b)))
      .slice(0, 8);
  }, [guests, excluded, query]);

  return (
    <div>
      <TextField value={query} onChange={setQuery} placeholder="Search guests…" />
      {query.trim() !== "" && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-charcoal/10">
          {matches.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-slate">No one matches.</li>
          ) : (
            matches.map((guest) => (
              <li key={guest.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(guest.id);
                    setQuery("");
                  }}
                  className="block w-full px-2 py-1.5 text-left text-sm text-charcoal hover:bg-stone"
                >
                  {guestName(guest) || "Unnamed guest"}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** One chosen guest, as a removable chip. */
export function GuestChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-charcoal/15 bg-stone px-2 py-0.5 text-xs text-charcoal">
      {name}
      <IconButton icon={X} label={`Remove ${name}`} onClick={onRemove} />
    </span>
  );
}
