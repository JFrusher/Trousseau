"use client";

import { X } from "lucide-react";
import { Panel } from "@/components/ui/controls";
import { GuestPicker } from "./GuestPicker";
import { guestName } from "@/lib/model/slices";
import { CAST_ROLES, ROLE_LABEL, type Guest, type Shots } from "@/lib/model/types";
import { setCastRole } from "@/lib/ensemble/actions";

/** Roles that hold at most one person. Everything else — the wedding party — holds many. */
const SINGLE_ROLES = new Set([
  "bride",
  "groom",
  "brides-mother",
  "brides-father",
  "grooms-mother",
  "grooms-father",
]);

export function CastPanel({
  shots,
  guests,
  onChange,
}: {
  shots: Shots;
  guests: Record<string, Guest>;
  onChange: (next: Shots) => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {CAST_ROLES.map((role) => {
        const chosen = shots.cast[role];
        const single = SINGLE_ROLES.has(role);
        return (
          <Panel key={role} title={ROLE_LABEL[role]}>
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {chosen.map((guestId) => (
                <li
                  key={guestId}
                  className="inline-flex items-center gap-1 rounded-full border border-charcoal/15 bg-stone px-2 py-0.5 text-xs text-charcoal"
                >
                  {guests[guestId] ? guestName(guests[guestId]!) || "Unnamed guest" : "Deleted guest"}
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => onChange(setCastRole(shots, role, chosen.filter((id) => id !== guestId)))}
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
              {chosen.length === 0 && <li className="text-sm text-slate">Not set yet.</li>}
            </ul>

            {(!single || chosen.length === 0) && (
              <GuestPicker
                guests={guests}
                exclude={chosen}
                onPick={(guestId) => onChange(setCastRole(shots, role, single ? [guestId] : [...chosen, guestId]))}
              />
            )}
          </Panel>
        );
      })}
    </div>
  );
}
