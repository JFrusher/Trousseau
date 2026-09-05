"use client";

import { useState } from "react";
import { Button, Panel, SelectField, TextArea, TextField } from "@/components/ui/controls";
import { GuestChip, GuestPicker } from "./GuestPicker";
import { guestName } from "@/lib/model/slices";
import { CAST_ROLES, ROLE_LABEL, type Guest, type Seating, type Shot, type ShotMember, type Shots } from "@/lib/model/types";
import { addMember, patchShot, removeMember } from "@/lib/ensemble/actions";

type MemberKind = ShotMember["kind"];

export function ShotInspector({
  shot,
  shots,
  guests,
  seating,
  onChange,
}: {
  shot: Shot;
  shots: Shots;
  guests: Record<string, Guest>;
  seating: Seating;
  onChange: (next: Shots) => void;
}) {
  const [addKind, setAddKind] = useState<MemberKind>("guest");
  const [textValue, setTextValue] = useState("");

  const addPicked = (ref: string) => {
    if (!ref) return;
    const member: ShotMember =
      addKind === "family"
        ? { kind: "family", ref }
        : addKind === "group"
          ? { kind: "group", ref }
          : { kind: "role", ref: ref as (typeof CAST_ROLES)[number] };
    onChange(addMember(shots, shot.id, member));
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <Panel title="Shot">
        <TextField
          label="Label"
          value={shot.label}
          onChange={(label) => onChange(patchShot(shots, shot.id, { label }))}
          placeholder="Leave blank to build it from who's in it"
        />
      </Panel>

      <Panel title="Who's in it">
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {shot.members.map((member, index) => (
            <li key={index}>
              <GuestChip
                name={memberLabel(member, guests, seating)}
                onRemove={() => onChange(removeMember(shots, shot.id, index))}
              />
            </li>
          ))}
          {shot.members.length === 0 && <li className="text-sm text-slate">Nobody added yet.</li>}
        </ul>

        <SelectField
          value={addKind}
          onChange={setAddKind}
          options={[
            { value: "guest", label: "Guest" },
            { value: "family", label: "Family" },
            { value: "group", label: "Group" },
            { value: "role", label: "Role" },
            { value: "text", label: "Text" },
          ]}
        />

        {addKind === "guest" && (
          <GuestPicker
            guests={guests}
            exclude={shot.members.filter((m) => m.kind === "guest").map((m) => m.ref)}
            onPick={(guestId) => onChange(addMember(shots, shot.id, { kind: "guest", ref: guestId }))}
          />
        )}

        {addKind === "family" && (
          <SelectField
            value=""
            onChange={addPicked}
            options={[
              { value: "", label: "Choose a family…" },
              ...Object.values(seating.families).map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
        )}

        {addKind === "group" && (
          <SelectField
            value=""
            onChange={addPicked}
            options={[
              { value: "", label: "Choose a group…" },
              ...[...Object.values(seating.groups), ...Object.values(seating.subgroups)].map((g) => ({
                value: g.id,
                label: g.name,
              })),
            ]}
          />
        )}

        {addKind === "role" && (
          <SelectField
            value=""
            onChange={addPicked}
            options={[
              { value: "", label: "Choose a role…" },
              ...CAST_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] })),
            ]}
          />
        )}

        {addKind === "text" && (
          <div className="flex gap-2">
            <TextField value={textValue} onChange={setTextValue} placeholder="e.g. the dog" />
            <Button
              tone="quiet"
              onClick={() => {
                if (!textValue.trim()) return;
                onChange(addMember(shots, shot.id, { kind: "text", ref: textValue.trim() }));
                setTextValue("");
              }}
            >
              Add
            </Button>
          </div>
        )}
      </Panel>

      <Panel title="Notes">
        <TextArea value={shot.notes} onChange={(notes) => onChange(patchShot(shots, shot.id, { notes }))} />
      </Panel>
    </div>
  );
}

function memberLabel(member: ShotMember, guests: Record<string, Guest>, seating: Seating): string {
  switch (member.kind) {
    case "guest": {
      const guest = guests[member.ref];
      return guest ? guestName(guest) || "Unnamed guest" : "Deleted guest";
    }
    case "family":
      return seating.families[member.ref]?.name ?? "Deleted family";
    case "group":
      return (seating.groups[member.ref] ?? seating.subgroups[member.ref])?.name ?? "Deleted group";
    case "role":
      return ROLE_LABEL[member.ref];
    case "text":
      return member.ref;
  }
}
