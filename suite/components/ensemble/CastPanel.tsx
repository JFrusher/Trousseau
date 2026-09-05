"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, IconButton, Panel, TextField } from "@/components/ui/controls";
import { GuestChip, GuestPicker } from "./GuestPicker";
import { guestName } from "@/lib/model/slices";
import { CAST_ROLES, ROLE_LABEL, type Guest, type Shots } from "@/lib/model/types";
import { addCustomRole, removeCustomRole, renameCustomRole, setCastRole, setCustomRoleMembers } from "@/lib/ensemble/actions";

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
  const [newRoleName, setNewRoleName] = useState("");

  return (
    <div className="flex flex-col gap-4 p-4">
      {CAST_ROLES.map((role) => {
        const chosen = shots.cast[role];
        const single = SINGLE_ROLES.has(role);
        return (
          <Panel key={role} title={ROLE_LABEL[role]}>
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {chosen.map((guestId) => (
                <li key={guestId}>
                  <GuestChip
                    name={guests[guestId] ? guestName(guests[guestId]!) || "Unnamed guest" : "Deleted guest"}
                    onRemove={() => onChange(setCastRole(shots, role, chosen.filter((id) => id !== guestId)))}
                  />
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

      {shots.customRoles.map((role) => (
        <div key={role.id} className="rounded border border-charcoal/10 p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              aria-label="Role name"
              value={role.name}
              onChange={(e) => onChange(renameCustomRole(shots, role.id, e.target.value))}
              className="min-w-0 flex-1 bg-transparent text-xs tracking-widest text-slate uppercase focus:outline-none"
            />
            <IconButton icon={Trash2} label={`Remove ${role.name}`} tone="danger" onClick={() => onChange(removeCustomRole(shots, role.id))} />
          </div>
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {role.guestIds.map((guestId) => (
              <li key={guestId}>
                <GuestChip
                  name={guests[guestId] ? guestName(guests[guestId]!) || "Unnamed guest" : "Deleted guest"}
                  onRemove={() =>
                    onChange(setCustomRoleMembers(shots, role.id, role.guestIds.filter((id) => id !== guestId)))
                  }
                />
              </li>
            ))}
            {role.guestIds.length === 0 && <li className="text-sm text-slate">Not set yet.</li>}
          </ul>
          <GuestPicker
            guests={guests}
            exclude={role.guestIds}
            onPick={(guestId) => onChange(setCustomRoleMembers(shots, role.id, [...role.guestIds, guestId]))}
          />
        </div>
      ))}

      <div className="flex gap-2">
        <TextField value={newRoleName} onChange={setNewRoleName} placeholder="e.g. Me and my family" />
        <Button
          tone="quiet"
          onClick={() => {
            if (!newRoleName.trim()) return;
            onChange(addCustomRole(shots, newRoleName.trim()));
            setNewRoleName("");
          }}
        >
          Add a role
        </Button>
      </div>
    </div>
  );
}
